import time
import numpy as np

from ai.app.common.database import SessionLocal
from ai.app.common.embedding import get_embeddings
from ai.app.vol_category.models import VolunteerCenterMirror

KEYWORD_RULES: list[tuple[str, list[str]]] = [
    ("장애인", ["장애인", "장애학생", "발달장애", "지적장애", "시각장애", "청각장애", "농아인", "점자"]),
    ("어르신", ["노인", "어르신", "경로", "요양원", "실버타운", "치매"]),
    ("아동청소년", ["아동", "청소년", "어린이", "지역아동센터", "유치원", "어린이집"]),
    ("다문화", ["다문화", "이주민", "이주노동자", "외국인"]),
    ("동물", ["동물", "유기견", "유기묘", "유기동물", "반려동물"]),
    ("환경", ["환경", "플로깅", "탄소중립", "분리배출"]),
    ("재난안전", ["재난", "방역", "소독", "산불", "수해", "태풍", "지진"]),
    ("교육", ["문해교육", "평생학습", "도서관"]),
    ("지역사회", ["복지관", "주민센터", "사회복지", "헌혈"]),
]

CATEGORIES: dict[str, list[str]] = {
    "환경": [
        "한강공원 플로깅 및 환경정화 봉사자를 모집합니다",
        "탄소중립 캠페인 홍보 및 분리배출 도우미 봉사활동",
        "하천 주변 쓰레기 수거 자원봉사자 모집",
    ],
    "동물": [
        "유기동물보호소 사료 배식 및 견사 청소 봉사자 모집",
        "동물병원 유기묘 돌봄 자원봉사자를 모집합니다",
        "반려동물 보호센터 산책 봉사활동 참여자 모집",
    ],
    "아동청소년": [
        "지역아동센터 학습지도 및 멘토링 봉사자 모집",
        "청소년 방과후교실 숙제지도 자원봉사자 모집",
        "아동 대상 동화구연 및 놀이활동 봉사자 모집",
    ],
    "어르신": [
        "독거노인 반찬 배달 및 안부확인 봉사자 모집",
        "노인복지관 어르신 말벗 및 산책 동행 봉사활동",
        "요양원 어르신 이미용 서비스 봉사자 모집",
    ],
    "장애인": [
        "장애인복지관 이동보조 및 활동지원 봉사자 모집",
        "발달장애아동 체육활동 보조 자원봉사자 모집",
        "시각장애인 점자도서 제작 봉사활동",
    ],
    "교육": [
        "성인 문해교육 강사 보조 봉사자 모집",
        "도서관 독서프로그램 진행 보조 봉사자 모집",
        "지역주민 대상 컴퓨터 활용교육 보조 봉사자 모집",
    ],
    "다문화": [
        "다문화가정 대상 한국어교육 봉사자 모집",
        "이주노동자 지원센터 통역 봉사활동",
        "외국인 유학생 정착지원 멘토 봉사자 모집",
    ],
    "재난안전": [
        "태풍 피해 복구 현장 정리 봉사활동 모집",
        "코로나19 방역 소독 봉사자를 모집합니다",
        "재난 안전 캠페인 홍보 부스 운영 봉사자 모집",
    ],
    "지역사회": [
        "지역 복지관 행사 진행 보조 봉사자 모집",
        "동주민센터 사무보조 및 행정지원 봉사활동",
        "이웃돕기 물품 포장 및 배분 봉사자 모집",
    ],
}

SIMILARITY_THRESHOLD = 0.35
TEXT_TRUNCATE_LENGTH = 200


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    a_arr, b_arr = np.array(a), np.array(b)
    denom = np.linalg.norm(a_arr) * np.linalg.norm(b_arr)
    if denom == 0:
        return 0.0
    return float(np.dot(a_arr, b_arr) / denom)


def _get_category_embeddings() -> dict[str, list[list[float]]]:
    return {name: get_embeddings(examples) for name, examples in CATEGORIES.items()}


def _match_keyword_category(center: VolunteerCenterMirror) -> str | None:
    identity_text = f"{center.vol_name or ''} {center.vol_title or ''}"
    for category, keywords in KEYWORD_RULES:
        if any(kw in identity_text for kw in keywords):
            return category
    return None


def _classify_by_embedding(vec: list[float], category_embeddings: dict[str, list[list[float]]]) -> str:
    best_category, best_score = "기타", -1.0
    for name, example_vecs in category_embeddings.items():
        score = max(_cosine_similarity(vec, ex_vec) for ex_vec in example_vecs)
        if score > best_score:
            best_category, best_score = name, score
    return best_category if best_score >= SIMILARITY_THRESHOLD else "기타"


def _build_classification_text(center: VolunteerCenterMirror) -> str:
    title = (center.vol_title or "").strip()
    act = (center.vol_act or "").strip()[:TEXT_TRUNCATE_LENGTH]
    return f"{title} {act}".strip()


def run_classification(chunk_size: int = 20, sleep_sec: float = 0.5) -> None:
    db = SessionLocal()
    try:
        targets = (
            db.query(VolunteerCenterMirror)
            .filter(VolunteerCenterMirror.ai_category.is_(None))
            .all()
        )
        total = len(targets)
        print(f"분류 대상 {total}건 시작")
        if total == 0:
            return

        keyword_hit = 0
        embedding_targets = []
        for center in targets:
            category = _match_keyword_category(center)
            if category:
                center.ai_category = category
                keyword_hit += 1
            else:
                embedding_targets.append(center)
        db.commit()
        print(f"키워드로 {keyword_hit}건 분류, 임베딩 폴백 대상 {len(embedding_targets)}건")

        if not embedding_targets:
            print(f"분류 완료: 키워드 {keyword_hit}건 (임베딩 폴백 없음)")
            return

        print("카테고리 예문 임베딩 준비 중...")
        category_embeddings = _get_category_embeddings()

        classified, skipped, fallback_other = 0, 0, 0
        for chunk_start in range(0, len(embedding_targets), chunk_size):
            chunk = embedding_targets[chunk_start:chunk_start + chunk_size]
            texts, valid_centers = [], []
            for center in chunk:
                text = _build_classification_text(center)
                if not text:
                    skipped += 1
                    continue
                texts.append(text)
                valid_centers.append(center)

            if not texts:
                continue

            try:
                text_vectors = get_embeddings(texts)
            except Exception as e:
                print(f"청크 {chunk_start} 임베딩 실패: {e}")
                skipped += len(texts)
                continue

            for center, vec in zip(valid_centers, text_vectors):
                category = _classify_by_embedding(vec, category_embeddings)
                if category == "기타":
                    fallback_other += 1
                center.ai_category = category
                classified += 1

            db.commit()
            print(f"[임베딩 {min(chunk_start + chunk_size, len(embedding_targets))}/{len(embedding_targets)}] 진행 중... (커밋)")
            time.sleep(sleep_sec)

        print(f"분류 완료: 키워드 {keyword_hit}건 + 임베딩 {classified}건(기타 {fallback_other}건), 스킵 {skipped}건")
    finally:
        db.close()


if __name__ == "__main__":
    run_classification()