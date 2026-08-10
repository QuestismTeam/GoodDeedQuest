import logging
from typing import Dict, Any, List, Final

import httpx
import openai
from pydantic import BaseModel, Field
from langchain_core.exceptions import OutputParserException
from langchain_core.prompts import ChatPromptTemplate

from ai.app.common.llm import get_openai_model, invoke_gemini_fallback
from ai.app.quest_recommend.state import RecommendState


logger: Final = logging.getLogger(__name__)


# ⭐ 수정: 제목 비교용 정규화 함수. 1차 중복 검사와 2차 판정 매칭이 같은 기준을 쓰게 한다.
def normalize_title(title: str) -> str:
    """제목을 비교용으로 정규화합니다 (공백 제거 + 소문자화)."""
    return (title or "").strip().lower().replace(" ", "")


class QuestEvaluation(BaseModel):
    """비평가 LLM이 개별 퀘스트를 심사한 결과를 담는 채점표 스키마"""
    quest_title: str = Field(
        ...,
        # "평가 대상 퀘스트의 제목. 입력받은 문자열을 글자 그대로 복사할 것"
        description="Title of the evaluated quest. Copy the input string exactly, character for character."
    )
    is_valid: bool = Field(
        ...,
        # ⭐ 수정: "확신이 없으면 True로 둘 것"을 스키마 수준에서 못 박는다.
        # "퀘스트가 안전하고 사용 가능하면 True. 확신이 없으면 True로 둘 것"
        description="True if the quest is safe and usable. When in doubt, set True."
    )
    reason: str = Field(
        ...,
        # "판단 사유 (영문 Planner 피드백용). 승인이면 짧은 구 하나, 반려면 상세히"
        description="Reason for the decision, in English, used as Planner feedback. If is_valid is true, write only a short phrase (e.g. 'Safe and usable'). If is_valid is false, explain the specific problem in detail so the planner can correct it."
    )
    reason_ko: str = Field(
        ...,
        # "판단 사유 (한국어 터미널 로그용). 승인이면 짧은 구 하나, 반려면 상세히"
        description="Same as 'reason' but written in Korean for terminal logging. Keep it to a short phrase when is_valid is true, and detailed when is_valid is false."
    )

class ValidationReportOutput(BaseModel):
    """비평가 LLM이 제출할 전체 후보군 심사 보고서 스키마"""
    evaluations: List[QuestEvaluation]=Field(
        default_factory=list,
        # "모든 후보 퀘스트에 대한 평가 결과 보고서"
        description="Evaluation reports for all candidate quests."
    )

def validate_candidates(state: RecommendState) -> Dict[str, Any]:
    """
    실제 봉사(retrieved_volunteers)와 AI가 생성한 일상 선행(ai_good_deeds)을 대상으로
    1차 기계적 필터링(중복/누락) 및 2차 LLM 비평가(Generator-Critic) 안전성 검수를 수행하는 노드 함수입니다.
    반려된 퀘스트의 영문 사유(reason)는 rejection_reasons에 수집되어 Planner 피드백으로 전달되며,
    한글 사유(reason_ko)는 로그 용으로 기록됩니다.
    """
    retrieved_volunteers = state.get("retrieved_volunteers", [])
    ai_good_deeds = state.get("ai_good_deeds", [])
    recommendation_strategy = state.get("recommendation_strategy", {})
    user_profile = state.get("user_profile", {})
    situation_context = state.get("situation_context", {})
    request_context = state.get("request_context", {})
    accumulated = list(state.get("accumulated_candidates", []))
    rejection_reasons_en = list(state.get("rejection_reasons_en", []))
    rejection_reasons_ko = list(state.get("rejection_reasons_ko", []))

    # 이전 회차(전체 루프) 누적 상자의 퀘스트 제목들을 미리 정규화하여 중복 목록에 등록
    seen_titles = {
        normalize_title(q.get("source_title") or q.get("quest_title"))
        for q in accumulated
        if q.get("source_title") or q.get("quest_title")
    }

    """1단계: 1차 기계적 필터링 (중복 제목 및 필수 필드 누락 제거)"""
    pre_filtered_quests= []

    # 1-1. 실제 봉사 데이터 매핑 (LLM 환각 0% 보존)
    for rank_index, vol in enumerate(retrieved_volunteers):
        source_title = vol.get("title") or "봉사활동"
        title = vol.get("quest_title") or source_title

        normalized = normalize_title(source_title)
        if normalized in seen_titles:
            continue
        seen_titles.add(normalized)

        quest_description = vol.get("quest_summary") or "지역 봉사활동 참여"
        vol_location = vol.get("location") or "장소 미지정"

        # 검색 상위일수록 높은 점수 (10, 9, 8 ... 최저 6점)
        volunteer_score = max(10 - rank_index, 6)

        pre_filtered_quests.append({
            "category_name": "VOLUNTEER",
            "quest_title": title,
            "quest_description": quest_description,
            "quest_target": "SOLO",
            "quest_type": "VOLUNTEER",
            "location": vol_location,
            "difficulty": "NORMAL",
            "intensity": 80,
            "estimated_duration": 180,
            "recommendation_reason": f"사용자 주변에 위치한 실제 봉사활동 기회입니다. ({vol_location})",
            "priority_score": volunteer_score,
            "center_id": vol.get("id"),
            "target": vol.get("target") or "지역 주민",
            "source_title": source_title,
        })

    # 1-2. AI 생성 일상 선행 데이터 1차 기계적 필터링
    for quest in ai_good_deeds:
        required_fields = ["quest_title", "quest_description", "quest_type", "category_name", "quest_target", "difficulty"]
        if not all(quest.get(field) for field in required_fields):
            logger.warning(f"1차 검수 탈락: 필수 필드 누락. 데이터: {quest}")
            continue

        # 이전 루프 포함 전체 중복 검사 (공백/소문자 통일)
        normalized = normalize_title(quest["quest_title"])
        if normalized in seen_titles:
            logger.warning(f"1차 검수 탈락: 전 루프 포함 중복 제목 감지 ('{quest['quest_title']}').")
            continue

        seen_titles.add(normalized)
        pre_filtered_quests.append(quest)

    if not pre_filtered_quests:
        logger.warning("1차 검수 결과 유효한 후보 퀘스트가 없습니다.")
        return {
            "candidate_quests": [],
            "accumulated_candidates": accumulated
        }

    """2단계: 2차 LLM 비평가(Critic) 안전성·중복 검수"""

    """
    ("system", "당신은 퀘스트 후보의 안전성·상식 검사관입니다. 적합도 심사관이 아닙니다.
        순위는 뒤쪽 점수 산정 단계가 정합니다. 당신의 유일한 일은 '정말로 쓸 수 없는' 후보만 걸러내는 것입니다.
        애매하면 통과시키세요. 평범한 퀘스트를 통과시키는 비용은 0이지만,
        멀쩡한 퀘스트를 반려하면 사용자 화면이 비어버립니다.

        반려(is_valid=false)는 다음 세 가지 경우에만 하세요.
        1. 안전: 신체적으로 위험하거나, 명백히 불가능하거나, 악용 소지가 있음
        2. 최근 추천과 제목이 거의 동일함 (주제·대상·카테고리가 겹치는 것은 사유가 아님)
        3. llm_constraints의 명시적 항목과 정면으로 충돌함
           (예: 비가 와서 실내 조건이 걸렸는데 야외 전용 활동인 경우)

        아래는 실제 운영에서 나온 '잘못된 반려'입니다. 절대 반복하지 마세요.
        - "어린이집 조리실을 돕는 활동이라 커뮤니티와 관련 없다" → 틀렸습니다. 어린이집 지원은 COMMUNITY입니다.
        - "노인 발톱 관리라 커뮤니티 관심사와 불일치" → 틀렸습니다. 어르신 돌봄은 COMMUNITY입니다.
        - "발달장애 청소년 지원이라 지역 사회 서비스와 무관" → 틀렸습니다. 장애인 지원은 COMMUNITY입니다.
        - "커뮤니티 센터 자원봉사가 커뮤니티 이니셔티브에 초점을 맞추지 않음" → 틀렸습니다. 자기모순입니다.
        - "동물 보호소 봉사라 사용자 관심사와 불일치" → 틀렸습니다. 관심사는 순위를 정할 뿐 자격이 아닙니다.
        - "팀 참여가 필요해 사용자의 개인 활동 선호와 불일치" → 틀렸습니다. 그런 정보는 입력에 없습니다.
        - "실내 활동이라 야외 선호와 불일치" → 틀렸습니다. 사용자가 요청하지 않은 조건입니다.
        - "설명이 짧다" → 틀렸습니다. 봉사 설명은 한 줄 요약이고 원문은 별도 화면에 있습니다.
        - "여러 번 참여해야 한다 / 경험자가 적합해 보인다 / 특정 요일에 열린다" → 전부 틀렸습니다.

        'VOLUNTEER'는 이미 게시된 실제 공고라 수정이 불가능합니다. 1번과 2번으로만 반려하세요.
        3번(제약조건 충돌)으로는 절대 반려하지 마세요."),
    ("human", "### 입력 정보 ... ### 평가할 퀘스트 목록 {pre_filtered_quests}")
    """
    validation_prompt = ChatPromptTemplate.from_messages([
        ("system", """You are a SAFETY AND SANITY filter for quest candidates. You are NOT a relevance ranker.

Relevance ranking happens later, in a separate scoring step that uses priority_score. Your only job is to remove candidates that are genuinely unusable. When in doubt, PASS. Letting a mediocre quest through costs nothing — it will simply rank low. Rejecting a good one leaves the user staring at an empty screen.

REJECT (is_valid=false) ONLY for these three reasons:
1. SAFETY — the quest is physically dangerous, clearly impossible, or open to abuse.
2. NEAR-IDENTICAL TITLE to an entry in 'recently_recommended'. That list is a history of titles already shown to this user; it is NOT a list of topics the user dislikes. Reject only when the titles are nearly the same word for word. Never because a quest shares a theme, an audience, or a category with something in that list.
3. DIRECT CONTRADICTION of an explicit item in 'llm_constraints' — for example, an outdoor-only activity when the constraints require indoor because of rain.

NEVER REJECT for any reason below. Every one of these is a real rejection from production that was WRONG:
- "helping in a daycare kitchen is not related to community activity" — WRONG. Supporting a daycare IS community support.
- "trimming an elderly person's toenails does not match the community interest" — WRONG. Elderly care IS community support.
- "supporting a photography club for youth with developmental disabilities is unrelated to community service" — WRONG. Supporting disabled youth IS community support.
- "volunteering at the local community centre does not focus on community initiatives" — WRONG, and self-contradictory. Read what the quest actually is.
- "animal shelter volunteering does not match the user's stated interests" — WRONG. A quest outside the user's interests is still valid. Interests affect ranking, not eligibility. The generator is deliberately instructed to include quests outside the user's interests.
- "this requires team participation and the user prefers solo activities" — WRONG. Nothing in the input states a solo preference. You invented it. Never reject on solo/team.
- "this is an indoor activity and does not match the outdoor preference" — WRONG unless the user explicitly asked for outdoor. Never invent an indoor/outdoor requirement.
- "the description is short / lacks detail" — WRONG. A VOLUNTEER description is a one-sentence summary; the full original posting is shown to the user on a separate screen.
- "it requires multiple sessions / suits experienced participants / falls on a particular weekday" — WRONG.
- "it is not the most relevant option available" — WRONG. That is the ranking step's job, not yours.

Scope of the six interest codes, for reference only (they do NOT gate eligibility):
- volunteer: volunteer work in general
- environment: cleanups, recycling, resource saving, climate action
- sharing: donations, sharing goods, sharing meals
- animal: rescued animal care, animal welfare
- community: helping neighbours and local events, AND support for elderly people, people with disabilities, children, low-income households and multicultural families. Supporting a daycare, a library, a welfare centre or a community centre all count as COMMUNITY.
- other: good deeds that fit none of the above

Real volunteer postings carry a 'target' field taken directly from the original listing (e.g. 청소년, 아동, 발달장애인, 입원 어르신). Trust it as the authoritative answer to "who does this activity help". Never confuse the volunteer recruitment criteria (age, qualifications) with the beneficiaries: a posting recruiting adult volunteers to help teenagers IS a youth activity.

For 'VOLUNTEER' candidates specifically: these are already-published listings with a fixed schedule, audience and venue. They cannot be rewritten to satisfy anything. Reject them ONLY under reason 1 or 2. Never under reason 3.

LENGTH RULES — follow exactly, they control response latency:
- When is_valid is true, write only a short phrase in 'reason' and 'reason_ko' (e.g. 'Safe and usable' / '안전하고 사용 가능'). Approval reasons are never read by any later step.
- When is_valid is false, explain the specific problem in detail so the planner can correct it.
- Copy 'quest_title' from the input exactly, character for character."""),
        ("human", """### Inputs
1. User Profile: {user_profile}
2. Situation Context: {situation_context}
3. Custom Request Context: {request_context}
4. Recommendation Strategy & Constraints: {recommendation_strategy}
### Quests to Evaluate
{pre_filtered_quests}""")
    ])

    input_data = {
        "user_profile": user_profile,
        "situation_context": situation_context,
        "request_context": request_context,
        "recommendation_strategy": recommendation_strategy,
        "pre_filtered_quests": pre_filtered_quests
    }

    response = None
    try:
        # 1. 정상 연산: OpenAI 모델 호출
        llm = get_openai_model(model_name="gpt-4o-mini", temperature=0.0)  # 일관성 있는 분석을 위해 온도=0.0
        structured_llm = llm.with_structured_output(ValidationReportOutput)

        validation_chain = validation_prompt | structured_llm
        response = validation_chain.invoke(input_data)

    except (openai.OpenAIError, OutputParserException, httpx.HTTPError) as e:
        # 2. OpenAI 장애 발생 시 Gemini 백업 함수 호출
        logger.warning(f"OpenAI 품질 검수 중 예외 발생 ({e}). Gemini 백업 모델을 가동합니다.")
        response = invoke_gemini_fallback(
            prompt=validation_prompt,
            input_data=input_data,
            structured_schema=ValidationReportOutput,
            temperature=0.0
        )
    except Exception as e:
        logger.warning(f"비평가 LLM 호출 실패: {e}. 1차 필터링 목록으로 임시 대체합니다.")

    # 3. 정상 반환 (OpenAI 또는 Gemini 성공 시)
    if response and response.evaluations:
        # ⭐ 수정: 제목을 정규화해서 매칭한다. LLM이 마침표나 공백을 하나 더 붙이는 것만으로도
        # 판정을 못 찾는 일이 있었다.
        title_to_evaluation = {
            normalize_title(eval_item.quest_title): eval_item
            for eval_item in response.evaluations
        }

        final_quests = []
        for q in pre_filtered_quests:
            eval_report = title_to_evaluation.get(normalize_title(q["quest_title"]))

            # ⭐ 수정: 판정이 아예 없으면 통과시킨다(fail-open).
            # 기존에는 판정 누락이 곧 반려였다. 비평가가 제목을 조금 바꾸거나 항목을 빠뜨리면
            # 멀쩡한 퀘스트가 조용히 사라졌다. '판정 없음'은 '문제 있음'의 증거가 아니다.
            if eval_report is None:
                logger.warning(f"검수 보고서에 판정이 없어 통과 처리합니다: '{q['quest_title']}'")
                final_quests.append(q)
                accumulated.append(q)
                continue

            if not eval_report.is_valid:
                reason_en = eval_report.reason or "Rejected by Critic."
                reason_ko = eval_report.reason_ko or "사유 미기재."

                rejection_reasons_en.append(f"'{q.get('quest_title')}': {reason_en}")
                rejection_reasons_ko.append(f"'{q.get('quest_title')}': {reason_ko}")
                # ⭐ 수정: 봉사인지 선행인지 로그에 표시한다. 봉사만 100% 반려되는 상황을
                # 로그만 보고 판별할 수 있어야 한다.
                logger.warning(
                    f"2차 검수 탈락 [{q.get('quest_type')}]: 퀘스트 '{q['quest_title']}' 반려 사유: {reason_ko}"
                )
                continue

            final_quests.append(q)
            accumulated.append(q)

        # ⭐ 수정: 봉사/선행을 나눠서 집계한다. 봉사 통과율이 0이면 즉시 눈에 띈다.
        volunteer_total = sum(1 for q in pre_filtered_quests if q.get("quest_type") == "VOLUNTEER")
        volunteer_passed = sum(1 for q in final_quests if q.get("quest_type") == "VOLUNTEER")
        logger.info(
            f"품질 검수 완료. 합격 {len(final_quests)}개 / 누적 {len(accumulated)}개 "
            f"(봉사 {volunteer_passed}/{volunteer_total}건 통과)"
        )

        return {
            "candidate_quests": final_quests,
            "accumulated_candidates": accumulated,
            "rejection_reasons_en": rejection_reasons_en,
            "rejection_reasons_ko": rejection_reasons_ko
        }

    # 4. 양대 LLM 모두 실패 시 1차 필터링 결과를 그대로 통과시킨다
    # ⭐ 수정: 기존에는 accumulated에 반영하지 않아 재시도 판정이 어긋났다.
    logger.warning("비평가 판정을 받지 못해 1차 필터링 목록을 그대로 통과시킵니다.")
    accumulated.extend(pre_filtered_quests)
    return {
        "candidate_quests": pre_filtered_quests,
        "accumulated_candidates": accumulated
        }

def route_validation(state: RecommendState) -> str:
    """
    검증 결과(candidate_quests / accumulated_candidates)와 재시도 횟수(retry_count)를 분석하여
    다음으로 이동할 랭그래프 노드(response / planner / volunteer)를 결정하는 라우터 함수입니다.
    """
    candidate_quests = state.get("candidate_quests", [])
    accumulated_candidates = state.get("accumulated_candidates", [])
    retrieved_volunteers = state.get("retrieved_volunteers", [])
    retry_count = state.get("retry_count", 0)
    skip_volunteer_agent = state.get("skip_volunteer_agent", False)

    total_candidates_count = len(accumulated_candidates) or len(candidate_quests)

    # 1. 합격 통과 (Pass) - 최종 추천 후보 5개 이상 확보 완료
    if total_candidates_count >= 5:
        logger.info(f"검증 통과: 최종 추천 후보 {total_candidates_count}개 확보 완료. 응답 생성 노드로 이동합니다.")
        return "response"

    # 2. 재시도 횟수 초과 (Max Retries Reached) - 무한 루프 방지를 위한 강제 폴백 종료
    if retry_count >= 2:
        logger.warning(f"재시도 횟수 초과 (현재 {retry_count}회): 후보 {total_candidates_count}개로 최종 응답을 구성합니다.")
        return "response"

    # 3. 봉사 데이터가 비었고 아직 '없음'이 확정되지 않은 경우에만 봉사 수색 노드로 회귀
    if not retrieved_volunteers and not skip_volunteer_agent:
        logger.info("검색된 봉사활동 데이터 부족: 추가 수집을 위해 volunteer 수색 노드로 회귀합니다.")
        return "volunteer"

    # 4. 추천 품질 낮음 - 검색 데이터는 존재하나 비평가(Critic) 심사에서 반려되어 후보가 부족해진 경우
    logger.warning(f"비평가 검수 탈락으로 인한 후보 부족 (현재 {total_candidates_count}개): 추천 전략 재수립을 위해 플래너로 회귀합니다.")
    return "planner"