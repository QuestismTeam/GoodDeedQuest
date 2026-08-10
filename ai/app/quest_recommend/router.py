import logging
from typing import Final
from fastapi import APIRouter, HTTPException, status

from ai.app.quest_recommend.schemas import (
    QuestRecommendRequest, QuestRecommendResponse,
    VolunteerSummaryRequest, VolunteerSummaryResponse,
)
from ai.app.quest_recommend.graph import run_recommendation_flow
from ai.app.quest_recommend.volunteer_summary import generate_volunteer_summaries

logger: Final = logging.getLogger(__name__)

router = APIRouter(prefix="/ai/recommend", tags=["AI Quest Recommendation"])

# run_recommendation_flow는 LangGraph를 동기로 invoke하고 그 안에서 LLM을 여러 번 부른다.
# async def 안에서 await 없이 부르면 그 20~40초 동안 AI 서버가 다른 요청을 하나도 못 받는다.
# def로 선언하면 FastAPI가 별도 스레드풀에서 돌려주므로 동시 요청이 서로를 막지 않는다.
@router.post("", response_model=QuestRecommendResponse)
def recommend_quests(req: QuestRecommendRequest) -> QuestRecommendResponse:
    """
    LangGraph 추천 워크플로우를 실행하여 사용자 맞춤형 5개 퀘스트를 반환합니다.
    """
    logger.info(f"AI 퀘스트 추천 요청 수신. 사용자 ID: {req.user_id}")

    try:
        initial_state = req.model_dump()

        final_state = run_recommendation_flow(initial_state)

        recommended_quests = final_state.get("recommended_quests", [])
        logger.info(f"AI 퀘스트 추천 워크플로우 정상 완료. 사용자 ID: {req.user_id}, 퀘스트 수: {len(recommended_quests)}")

        return QuestRecommendResponse(
            success=True,
            message="추천 퀘스트 생성이 완료되었습니다.",
            data=recommended_quests
        )

    except Exception as e:
        logger.error(f"AI 퀘스트 추천 연산 중 예외 발생. 사용자 ID: {req.user_id}, 에러: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="AI 퀘스트 추천 처리 중 내부 오류가 발생했습니다."
        )


# 신규 — 지도에서 사용자가 직접 고른 봉사공고 1건을 그 자리에서 퀘스트 제목/요약으로
# 변환한다. generate_volunteer_summaries()는 여러 건을 한 번에 LLM 호출로 처리하려고 만들어진
# 함수라 리스트를 받지만, 여기선 항상 1건짜리 리스트로 호출한다(백엔드가 단건으로 부르므로).
# LLM이 실패해도 generate_volunteer_summaries 내부에서 규칙 기반 폴백을 이미 보장하므로,
# 이 엔드포인트 자체는 예외를 던지지 않는다(백엔드 쪽에서 502로 잡지 않아도 되게).
@router.post("/volunteer-summary", response_model=dict)
def summarize_volunteer_center(req: VolunteerSummaryRequest):
    logger.info(f"봉사 공고 단건 요약 요청. center_id={req.center_id}")

    center_dict = {
        "center_id": req.center_id,
        "vol_title": req.vol_title,
        "vol_name": req.vol_name,
        "target": req.target,
        "vol_act": req.vol_act,
    }
    summaries = generate_volunteer_summaries([center_dict])
    quest_title, quest_summary = summaries[req.center_id]

    return {
        "success": True,
        "data": VolunteerSummaryResponse(quest_title=quest_title, quest_summary=quest_summary).model_dump(),
    }