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

@router.post("", response_model=QuestRecommendResponse)
async def recommend_quests(req: QuestRecommendRequest) -> QuestRecommendResponse:
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