from datetime import datetime, timedelta, timezone
from typing import Annotated, List

import httpx
from fastapi import APIRouter, Depends, HTTPException

from backend.app.common.response import APIResponse
from backend.app.common.auth import get_current_user
from backend.app.common.config import get_setting
from backend.app.common.deps import get_repository
from backend.app.common.enums import Difficulty
from backend.app.common.repository import DatabaseRepository
from backend.app.quest.models import Quest, Category, QuestHiddenPreference, QuestStart
from backend.app.quest.enums import QuestTarget, QuestType, QuestSource, QuestStatus
from backend.app.quest.rewards import reward_from_intensity
from backend.app.quest.service import started_quest_ids
from backend.app.quest.schemas import QuestSchema, CreateQuestRequest, CreateQuestResponse, DeleteQuestResponse
from backend.app.auth.router import get_current_db_user
from backend.app.auth.models import User
from backend.app.quest_verification.models import QuestSubmission
from backend.app.quest_verification.enums import SubmissionStatus
from backend.app.quest.rate_limit import count_daily_use
from backend.app.quest.similarity import find_similar_quest
from backend.app.map.models import VolunteerCenter

# 하루에 만들 수 있는 커스텀 퀘스트 수.
# 같은 활동을 여러 개 만드는 것 자체는 막지 않는다. 인증 단계에서 사진·영상
# 재사용이 걸러지므로, 여기서는 생성 횟수 상한만 둔다.

DAILY_CREATE_LIMIT = 5

DAILY_PREVIEW_LIMIT = 10
# created_at은 UTC로 저장되는데 사용자가 느끼는 '오늘'은 한국 시간이다.
KST = timezone(timedelta(hours=9))

QuestRepository = Annotated[
    DatabaseRepository[Quest],
    Depends(get_repository(Quest))
]

CategoryRepository = Annotated[
    DatabaseRepository[Category],
    Depends(get_repository(Category))
]

SubmissionRepository = Annotated[
    DatabaseRepository[QuestSubmission],
    Depends(get_repository(QuestSubmission))
]

HiddenRepository = Annotated[
    DatabaseRepository[QuestHiddenPreference],
    Depends(get_repository(QuestHiddenPreference))
]

StartRepository = Annotated[
    DatabaseRepository[QuestStart],
    Depends(get_repository(QuestStart))
]

VolunteerCenterRepository = Annotated[
    DatabaseRepository[VolunteerCenter],
    Depends(get_repository(VolunteerCenter))
]

router = APIRouter(prefix="/quests", tags=["Quests"])


def _evaluate(quest_title: str, quest_description: str, category_name: str) -> dict:
    """AI 서버에 심사를 맡긴다. 선행 여부와 난이도만 돌려받는다."""
    try:
        response = httpx.post(
            f"{get_setting().AI_SERVICE_URL}/ai/quest-create/evaluate",
            json={
                "quest_title": quest_title,
                "quest_description": quest_description,
                "category_name": category_name,
            },
            timeout=60.0,
        )
        response.raise_for_status()
        return response.json()["data"]
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="AI 심사 서버 호출에 실패했습니다.")


def _judge(req: CreateQuestRequest, category: Category, quest_repository) -> tuple[CreateQuestResponse, dict]:
    """심사 한 번. 미리보기와 등록이 같은 판단을 쓰도록 여기로 모았다.

    돌려주는 dict에는 저장에 필요한 재료(난이도·보상·임베딩)가 들어 있다.
    """
    embedding = _embed(req.quest_title, req.quest_description, category.name)
    
    twin, score = find_similar_quest(quest_repository, embedding)
    if twin is not None:
        print(f"유사 퀘스트 승계: #{twin.quest_id} '{twin.quest_title}' (유사도 {score:.3f})")
        response = CreateQuestResponse(
            accepted=True,
            reason="이미 등록된 비슷한 퀘스트와 같은 보상을 적용했어요.",
            difficulty=twin.difficulty,
            reward_point=twin.reward_point,
            reward_exp=twin.reward_exp,
        )
        
        return response, {"difficulty": twin.difficulty, "point": twin.reward_point,
                        "exp": twin.reward_exp, "embedding": embedding}

    result = _evaluate(req.quest_title, req.quest_description, category.name)

    if not result.get("accepted"):
        return CreateQuestResponse(accepted=False, reason=result.get("reason", "")), {}    

    difficulty = Difficulty(result["difficulty"])
    point, exp = reward_from_intensity(difficulty, result["intensity"])

    response = CreateQuestResponse(
        accepted=True,
        reason=result.get("reason", ""),
        difficulty=difficulty,
        reward_point=point,
        reward_exp=exp,
    )
    return response, {"difficulty": difficulty, "point": point, "exp": exp,
                            "embedding": embedding}


@router.get("", response_model=APIResponse[List[QuestSchema]])
def get_all_quests(
    quest_repository: QuestRepository,
    submission_repository: SubmissionRepository,
    hidden_repository: HiddenRepository,
    current_user: User = Depends(get_current_db_user),
):
    """전체 퀘스트 목록을 조회합니다. 내가 이미 완료한 퀘스트는 제외한다."""
    done_ids = _completed_quest_ids(submission_repository, current_user.user_id)
    hidden_ids = _hidden_quest_ids(hidden_repository, current_user.user_id)
    started_ids = _started_quest_ids(submission_repository, current_user.user_id)
    quests = [q for q in quest_repository.filter(Quest.is_deleted == False) if q.quest_id not in done_ids and q.quest_id not in hidden_ids]
    return APIResponse.ok(data=[
        QuestSchema.from_quest(q, viewer_id=current_user.user_id,
                               started_ids=started_ids, done_ids=done_ids)
        for q in quests
    ])


@router.get("/{quest_id}", response_model=APIResponse[QuestSchema])
def get_quest_detail(
    quest_id: int,
    quest_repository: QuestRepository,
    submission_repository: SubmissionRepository,
    current_user: User = Depends(get_current_db_user),
):
    """특정 퀘스트의 상세 정보를 조회합니다.

    완료한 퀘스트도 주소로 직접 열면 볼 수 있다. 목록에서 감추는 것과는 별개다.
    상태는 보는 사람 기준으로 계산한다 — 내가 완료했으면 COMPLETED 로 보인다.

    【판단】 get_current_user 는 토큰이 없으면 막지 않고 목업 사용자를 돌려준다
           (common/auth.py:44). 그래서 이 엔드포인트만 토큰 없이 200 이 나왔다.
           목록과 같은 get_current_db_user 로 맞춘다.
    """
    quest = quest_repository.get(quest_id)
    if quest is None or quest.is_deleted    :
        raise HTTPException(status_code=404, detail="Quest not found")
    done_ids = _completed_quest_ids(submission_repository, current_user.user_id)
    started_ids = _started_quest_ids(submission_repository, current_user.user_id)
    return APIResponse.ok(data=QuestSchema.from_quest(
        quest, viewer_id=current_user.user_id,
        started_ids=started_ids, done_ids=done_ids,
    ))


@router.post("/{quest_id}/start", response_model=APIResponse[QuestSchema])
def start_quest(
    quest_id: int,
    quest_repository: QuestRepository,
    start_repository: StartRepository,
    submission_repository: SubmissionRepository,
    current_user: User = Depends(get_current_db_user),
):
    """퀘스트를 시작 상태로 만듭니다.

    quest.quest_status 컬럼은 건드리지 않는다. 퀘스트당 값이 하나뿐이라
    거기에 쓰면 한 사람이 시작해도 모두에게 진행중으로 보인다.
    대신 quest_start 에 사람별 기록을 남긴다.

    이미 시작한 퀘스트를 다시 시작해도 오류를 내지 않는다. 버튼이 두 번 눌리거나
    재시도되는 경우가 있는데, 어느 쪽이든 결과는 '시작됨'으로 같기 때문이다.
    """
    quest = quest_repository.get(quest_id)
    if quest is None or quest.is_deleted:
        raise HTTPException(status_code=404, detail="Quest not found")

    already = start_repository.get_by(user_id=current_user.user_id, quest_id=quest_id)
    if not already:
        start_repository.create({
            "user_id": current_user.user_id,
            "quest_id": quest_id,
        })

    done_ids = _completed_quest_ids(submission_repository, current_user.user_id)
    started_ids = _started_quest_ids(submission_repository, current_user.user_id)
    return APIResponse.ok(data=QuestSchema.from_quest(
        quest, viewer_id=current_user.user_id,
        started_ids=started_ids, done_ids=done_ids,
    ), message="퀘스트를 시작했습니다.")


def _summarize_volunteer_center(center: VolunteerCenter) -> tuple[str, str]:
    try:
        response = httpx.post(
            f"{get_setting().AI_SERVICE_URL}/ai/recommend/volunteer-summary",
            json={
                "center_id": center.center_id,
                "vol_title": center.vol_title,
                "vol_name": center.vol_name,
                "target": center.target,
                "vol_act": center.vol_act,
            },
            timeout=30.0,
        )
        response.raise_for_status()
        data = response.json()["data"]
        return data["quest_title"], data["quest_summary"]
    except (httpx.HTTPError, KeyError, ValueError, TypeError) as e:
        print(f"봉사 공고 AI 요약 실패, 원문으로 대체함: center_id={center.center_id} {type(e).__name__}: {e}")
        fallback_title = (center.vol_title or center.vol_name or "봉사활동 참여")[:200]
        fallback_summary = center.vol_act or "봉사활동에 참여하고 인증하면 보상을 받아요."
        return fallback_title, fallback_summary


@router.post("/from-volunteer-center/{center_id}", response_model=APIResponse[QuestSchema])
def get_or_create_quest_from_volunteer_center(
    center_id: int,
    quest_repository: QuestRepository,
    category_repository: CategoryRepository,
    center_repository: VolunteerCenterRepository,
    submission_repository: SubmissionRepository,
    current_user: User = Depends(get_current_db_user),
):
    center = center_repository.get(center_id)
    if center is None:
        raise HTTPException(status_code=404, detail="봉사 공고를 찾을 수 없습니다.")

    quest = quest_repository.get_by(volunteer_center_id=center_id, is_deleted=False)

    if quest is None:
        category = _load_category(category_repository, "volunteer")

        if center.quest_title and center.quest_summary:
            quest_title, quest_description = center.quest_title, center.quest_summary
        else:
            quest_title, quest_description = _summarize_volunteer_center(center)
            center.quest_title = quest_title
            center.quest_summary = quest_description
            center_repository.session.commit()

        quest_title = quest_title[:200]
        point, exp = reward_from_intensity(Difficulty.NORMAL, 50)

        quest = quest_repository.create({
            "category_id": category.category_id,
            "creator_id": current_user.user_id,
            "quest_title": quest_title,
            "quest_description": quest_description,
            "quest_target": QuestTarget.SOLO,
            "quest_type": QuestType.VOLUNTEER,
            "quest_source": QuestSource.ADMIN,
            "location": center.vol_address,
            "volunteer_center_id": center.center_id,
            "difficulty": Difficulty.NORMAL,
            "reward_point": point,
            "reward_exp": exp,
            "quest_status": QuestStatus.NOT_STARTED,
        })

    done_ids = _completed_quest_ids(submission_repository, current_user.user_id)
    started_ids = _started_quest_ids(submission_repository, current_user.user_id)
    return APIResponse.ok(data=QuestSchema.from_quest(
        quest, viewer_id=current_user.user_id,
        started_ids=started_ids, done_ids=done_ids,
    ))


def _load_category(category_repository: CategoryRepository, code: str) -> Category:
    category = category_repository.get_by(code=code)
    if category is None:
        raise HTTPException(status_code=400, detail="알 수 없는 카테고리입니다.")
    return category


def _created_today(quest_repository: QuestRepository, user_id: int) -> int:
    """오늘(한국 시간 기준) 내가 만든 커스텀 퀘스트 수."""
    
    """is_deleted 를 일부러 보지 않는다. 치운 퀘스트도 세야 한다 —
    빼면 5개 만들고 지우고 또 만드는 식으로 상한을 무한히 우회할 수 있고,
    이 상한은 애초에 Gemini 호출 비용을 막으려고 둔 것이다."""
    start_kst = datetime.now(KST).replace(hour=0, minute=0, second=0, microsecond=0)
    # created_at은 시간대 정보 없는 UTC로 저장되므로 같은 형태로 맞춰 비교한다
    start_utc = start_kst.astimezone(timezone.utc).replace(tzinfo=None)
    return len(quest_repository.filter(
        Quest.creator_id == user_id,
        Quest.quest_source == QuestSource.USER,
        Quest.created_at >= start_utc,
    ))
    
def _completed_quest_ids(submission_repository, user_id: int) -> set[int]:
    return {
            s.quest_id
        for s in submission_repository.filter(
            QuestSubmission.user_id == user_id,
            QuestSubmission.final_status == SubmissionStatus.ACCEPTED,
        )
    }

def _started_quest_ids(submission_repository, user_id: int) -> set[int]:
    """내가 손을 댄 퀘스트. 인증을 냈거나 시작 버튼을 누른 것을 합친다.

    거절·보류도 "손을 댄" 것이므로 진행중으로 본다. 통과한 것은 호출부에서
    done_ids 로 이미 목록에서 빠진다.
    """
    return started_quest_ids(submission_repository.session, user_id)


def _hidden_quest_ids(hidden_repository: HiddenRepository, user_id:int) -> set[int]:
    return {
        h.quest_id
        for h in hidden_repository.filter(QuestHiddenPreference.user_id == user_id)
    }


@router.post("/preview", response_model=APIResponse[CreateQuestResponse])
def preview_quest(
    req: CreateQuestRequest,
    quest_repository: QuestRepository,
    category_repository: CategoryRepository,
    current_user: User = Depends(get_current_db_user),
):
    """등록하기 전에 심사 결과만 미리 본다. 저장하지 않는다."""
    category = _load_category(category_repository, req.category_code)

    if not count_daily_use("quest_preview", current_user.user_id, DAILY_PREVIEW_LIMIT):
        return APIResponse.ok(data=CreateQuestResponse(
            accepted=False,
            reason=f"미리보기는 하루 {DAILY_PREVIEW_LIMIT}번까지 쓸 수 있어요. 내일 다시 시도해 주세요.",
        ))

    response, _ = _judge(req, category, quest_repository)
    return APIResponse.ok(data=response)


@router.post("", response_model=APIResponse[CreateQuestResponse])
def create_quest(
    req: CreateQuestRequest,
    quest_repository: QuestRepository,
    category_repository: CategoryRepository,
    current_user: User = Depends(get_current_db_user),
):
    """커스텀 퀘스트를 등록한다. 보상은 미리보기 값이 아니라 여기서 다시 판정한다."""
    category = _load_category(category_repository, req.category_code)

    # AI를 부르기 전에 횟수부터 확인한다 (막힐 요청에 비용을 쓰지 않도록)
    made_today = _created_today(quest_repository, current_user.user_id)
    if made_today >= DAILY_CREATE_LIMIT:
        return APIResponse.ok(data=CreateQuestResponse(
            accepted=False,
            reason=f"퀘스트는 하루에 {DAILY_CREATE_LIMIT}개까지 만들 수 있어요. 내일 다시 시도해 주세요.",
        ))

    response, material = _judge(req, category, quest_repository)

    if not response.accepted:
        return APIResponse.ok(data=response)

    quest = quest_repository.create({
        "category_id": category.category_id,
        "creator_id": current_user.user_id,
        "quest_title": req.quest_title,
        "quest_description": req.quest_description,
        # 개인 선행이므로 GOOD_DEED. VOLUNTEER는 VMS 확인서가 필요해 유저가 만들 수 없다.
        "quest_type": QuestType.GOOD_DEED,
        "quest_source": QuestSource.USER,
        "quest_status": QuestStatus.IN_PROGRESS,
        "difficulty": material["difficulty"],
        "reward_point": material["point"],
        "reward_exp": material["exp"],
        # 다음 중복 검사의 재료가 된다
        "quest_embedding": material["embedding"],
    })

    response.quest_id = quest.quest_id
    return APIResponse.ok(data=response)

@router.delete("/{quest_id}", response_model=APIResponse[DeleteQuestResponse])
def delete_quest(
    quest_id: int,
    quest_repository: QuestRepository,
    hidden_repository: HiddenRepository,
    current_user: User = Depends(get_current_db_user),
):
    
    quest = quest_repository.get(quest_id)
    if quest is None or quest.is_deleted:
        raise HTTPException(status_code=404, detail="Quest not found")

    is_mine = (
        quest.quest_source == QuestSource.USER
        and quest.creator_id == current_user.user_id
    )

    if is_mine:
        quest.is_deleted = True
        quest_repository.session.commit()
        return APIResponse.ok(
            data=DeleteQuestResponse(deleted=True),
            message="퀘스트를 삭제했습니다.",
        )

    
    already_hidden = hidden_repository.get_by(
        user_id=current_user.user_id,
        quest_id=quest_id,
    )
    if already_hidden is None:
        hidden_repository.create({
            "user_id": current_user.user_id,
            "quest_id": quest_id,
        })

    return APIResponse.ok(
        data=DeleteQuestResponse(deleted=False),
        message="목록에서 치웠습니다.",
    )

def _embed(quest_title: str, quest_description: str, category_name: str) -> list[float]:
    try:
        response = httpx.post(
            f"{get_setting().AI_SERVICE_URL}/ai/quest-create/embed",
            json={
                "quest_title": quest_title,
                "quest_description": quest_description,
                "category_name": category_name,
            },
            timeout=15.0,
        )
        response.raise_for_status()
        return response.json()["data"]["embedding"] or []
    except httpx.HTTPError:
        return []