"""
RAG Agent (BGM 매칭)

입력: state["vision_results"] (씬 분위기/태그)
출력: state["bgm_match"] (매칭된 BgmMatchResult)

mood_tags는 고정 vocab 12개 안에서만 나오므로, pgvector 유사도 검색 대신
BackgroundMusic.mood_tag에 대한 exact match(WHERE mood_tag IN (...))로 매칭한다.
ShortForm.bgm_id는 NOT NULL 이므로 이 단계에서 반드시 값이 채워져야 함.

이슈 #88 스코프: 쿼리 결과를 BgmMatchResult로 파싱 + fallback 전략 확정
+ 전체 파이프라인 동작 테스트. (#87에서 raw 쿼리 호출까지는 이미 검증됨)
"""
import logging
import random
from collections import Counter

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import BackgroundMusic
from ...common.database import SessionLocal
from ..state import ShortFormState, BgmMatchResult

logger = logging.getLogger(__name__)


def rag_agent(state: ShortFormState) -> ShortFormState:
    mood_tags = [tag for r in state["vision_results"] for tag in r["mood_tags"]]
    logger.info(f"[RagAgent] mood_tags={mood_tags}")

    try:
        with SessionLocal() as session:
            candidates = session.scalars(
                select(BackgroundMusic).where(BackgroundMusic.mood_tag.in_(mood_tags))
            ).all()

            if candidates:
                state["bgm_match"] = _pick_best_match(candidates, mood_tags)
            else:
                state["bgm_match"] = _pick_fallback(session, mood_tags)

    # ⭐ 추가: RuntimeError(BGM 테이블 비어있음 = 데이터 시딩 문제)는
    # 하드 fallback으로 덮지 않고 그대로 위로 전파시켜서 시끄럽게 실패시킴
    except RuntimeError:
        logger.error("[RagAgent] BGM 데이터 시딩 문제로 파이프라인 중단")
        raise

    except Exception:
        logger.exception("[RagAgent] BackgroundMusic 쿼리 실패, 하드 fallback으로 대체")
        # DB 쿼리 자체가 실패한 경우(연결 끊김 등) — bgm_id NOT NULL 제약 때문에
        # 파이프라인을 죽이는 대신 최후의 fallback으로 처리.
        # 알려진 제약: 재시도 없이 1회 실패 = 즉시 fallback.
        state["bgm_match"] = _hard_fallback()

    logger.info(f"[RagAgent] bgm_match={state['bgm_match']}")
    return state


# ⭐ 신규: mood_tag 등장 빈도 기반 우선순위 로직
def _pick_best_match(
    candidates: list[BackgroundMusic], mood_tags: list[str]
) -> BgmMatchResult:
    """
    mood_tag 컬럼은 BGM 1곡당 태그 1개만 가지므로, 후보들 중에서는
    vision_results 전체에서 해당 태그가 얼마나 자주 등장했는지로 우선순위를 정한다.
    (예: 사진 5장 중 4장이 "신나는", 1장만 "발랄한"이면 "신나는" 태그 BGM을 우선)
    동점(같은 등장 빈도)이면 랜덤으로 선택.
    """
    tag_counts = Counter(mood_tags)
    total = len(mood_tags)

    scored = [
        (candidate, tag_counts[candidate.mood_tag] / total)
        for candidate in candidates
    ]
    max_score = max(score for _, score in scored)
    top_candidates = [c for c, score in scored if score == max_score]

    chosen = random.choice(top_candidates)

    return {
        "bgm_id": chosen.bgm_id,
        "bgm_title": chosen.title,
        "match_score": round(max_score, 2),
        "match_reason": (
            f"'{chosen.mood_tag}' 태그가 vision_results 전체 mood_tags 중 "
            f"{max_score:.0%} 비중으로 가장 우세하여 매칭됨"
        ),
    }


# ⭐ 신규: 매칭 0개일 때 fallback
def _pick_fallback(session: Session, mood_tags: list[str]) -> BgmMatchResult:
    """
    mood_tags와 정확히 일치하는 BGM이 하나도 없을 때: 전체 BGM 중 랜덤 선택.
    ShortForm.bgm_id가 NOT NULL이라 이 단계에서 반드시 값이 채워져야 한다.
    """
    all_bgms = session.scalars(select(BackgroundMusic)).all()

    if not all_bgms:
        # BGM 테이블 자체가 비어있음 = 매칭 실패가 아니라 데이터 시딩 문제.
        # 조용히 넘기면 이후 FFmpeg 렌더 단계에서 더 알기 힘든 에러로 터지므로
        # 여기서 명확하게 실패시킨다.
        raise RuntimeError(
            "BackgroundMusic 테이블이 비어있습니다. BGM 데이터 시딩이 필요합니다."
        )

    chosen = random.choice(all_bgms)
    logger.warning(
        f"[RagAgent] mood_tags={mood_tags}와 일치하는 BGM 없음, "
        f"전체 {len(all_bgms)}곡 중 랜덤 fallback: {chosen.title}"
    )

    return {
        "bgm_id": chosen.bgm_id,
        "bgm_title": chosen.title,
        "match_score": 0.0,
        "match_reason": f"mood_tags({mood_tags})와 일치하는 BGM 없음, 전체 중 랜덤 선택",
    }


# ⭐ 신규: DB 쿼리 자체가 실패했을 때의 최후 fallback
def _hard_fallback() -> BgmMatchResult:
    """
    DB 쿼리 자체가 실패했을 때(연결 끊김 등) 사용하는 최후의 fallback.
    ⚠️ bgm_id=1이 실제 DB에 존재하는 레코드인지 반드시 확인 필요 — 하드코딩된 값이라
    없으면 여기서도 NOT NULL 제약 위반으로 다시 실패함. 설정값(config)으로 분리하지 않고
    상수로 유지 중.
    """
    return {
        "bgm_id": 1,
        "bgm_title": "기본 BGM (DB 조회 실패)",
        "match_score": 0.0,
        "match_reason": "DB 쿼리 실패로 인한 하드 fallback",
    }