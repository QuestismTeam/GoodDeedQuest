from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from typing import Annotated
import httpx
import uuid
from backend.app.common.response import APIResponse
from backend.app.common.auth import get_current_user
from backend.app.common.config import get_setting
from backend.app.common.deps import get_repository
from backend.app.common.repository import DatabaseRepository
from backend.app.quest.models import Quest
from backend.app.quest.enums import QuestType
from backend.app.quest_verification.schemas import (
    PresignRequest, PresignResponse, SubmitRequest, SubmitResponse, ChallengeRequest,
)
from backend.app.quest_verification.models import QuestSubmission
from backend.app.quest_verification.enums import MediaType, SubmissionStatus
from backend.app.common.s3_client import (
    generate_internal_download_url,
    generate_upload_presigned_url,
)
from backend.app.quest_verification.media import (compute_sha256, compute_media_phash, find_nearest_submission, is_duplicate)
from backend.app.quest_verification.challenge import (
    generate_challenge_code, build_challenge_message, calculate_suspicion, needs_challenge,
)
from backend.app.badge.service import check_and_award_badges
from backend.app.auth.router import get_current_db_user
from backend.app.auth.models import User, PointTransaction
from backend.app.auth.enums import TransactionType
from backend.app.quest_verification.trust import (
    adjust_trust, TRUST_ON_COMPLETE, TRUST_ON_CHALLENGE, TRUST_ON_REJECT
)
from backend.app.quest.rate_limit import count_daily_use
from backend.app.quest_verification.verdict import decide, settle, _grant_reward

DAILY_SUBMIT_LIMIT = 5

QuestRepository = Annotated[
    DatabaseRepository[Quest],
    Depends(get_repository(Quest))
]

SubmissionRepository = Annotated[
    DatabaseRepository[QuestSubmission],
    Depends(get_repository(QuestSubmission))
]

router = APIRouter(prefix="/quest-verification", tags=["Quest AI Verification"])

@router.post("/presign", response_model=PresignResponse)
def get_upload_url(req: PresignRequest, current_user: User = Depends(get_current_db_user)):
    ext = "mp4" if req.content_type.startswith("video/") else "jpg"
    s3_key = f"submission/{current_user.user_id}/{req.quest_id}/{uuid.uuid4()}.{ext}"
    upload_url =  generate_upload_presigned_url(s3_key, req.content_type)
    return PresignResponse(upload_url=upload_url, s3_key=s3_key)

@router.post('/submit', response_model=SubmitResponse)
def submit_verification(
    req: SubmitRequest,
    quest_repository: QuestRepository,
    submission_respository: SubmissionRepository,
    current_user: User = Depends(get_current_db_user)
):
    quest = quest_repository.get(req.quest_id)
    if quest is None:
        raise HTTPException(status_code=404, detail="Quest not found")
    
    already_done = submission_respository.get_by(
        user_id=current_user.user_id,
        quest_id=req.quest_id,
        final_status=SubmissionStatus.ACCEPTED
    )
    if already_done is not None:
        raise HTTPException(status_code=400, detail="이미 완료한 퀘스트입니다.")
    
    stale_pendings = submission_respository.filter(
        QuestSubmission.user_id == current_user.user_id,
        QuestSubmission.quest_id == req.quest_id,
        QuestSubmission.final_status.in_([
            SubmissionStatus.PENDING,
            SubmissionStatus.ON_HOLD,
        ])
    )
    for stale in stale_pendings:
        stale.final_status = SubmissionStatus.REJECTED
        stale.challenge_code = None
    
    if stale_pendings:
        submission_respository.session.commit()
        print(f"옛 챌린지 {len(stale_pendings)}건 만료: user={current_user.user_id} quest={req.quest_id}")
        
    extra_keys = req.extra_media_keys or []
    
    if len(extra_keys) > 4:
        raise HTTPException(status_code=400, detail="추가 사진은 최대 4장까지 가능합니다.")
    
    all_keys = [req.s3_key] + extra_keys
    
    expected_prefix = f"submission/{current_user.user_id}/{req.quest_id}/"
    for key in all_keys:
        if not key.startswith(expected_prefix) or ".." in key:
            print(f"잘못된 업로드 경로 거절: user={current_user.user_id} key={key}")
            raise HTTPException(status_code=400, detail="잘못된 업로드 경로입니다.")
    
    media_urls = [generate_internal_download_url(key) for key in all_keys]
    is_video = quest.quest_type != QuestType.VOLUNTEER

    media_hash = None
    primary_phash = None
    
    for index, url in enumerate(media_urls):
        image_bytes = httpx.get(url, timeout=30.0).content
        photo_hash = compute_sha256(image_bytes)
        if media_hash is None:
            media_hash = photo_hash
            # 판정 근거가 되는 대표 증빙만 pHash를 계산한다
            primary_phash = compute_media_phash(image_bytes, is_video)

        duplicate = submission_respository.get_by(media_hash = photo_hash, final_status = SubmissionStatus.ACCEPTED)
        if duplicate is not None:
            adjust_trust(current_user, TRUST_ON_REJECT)
            submission_respository.create({
                "user_id": current_user.user_id,
                "quest_id": quest.quest_id,
                "media_url": req.s3_key,
                "media_hash": photo_hash,
                "final_status": SubmissionStatus.REJECTED,
                "ai_verdict": {"verified": False, "reason": "duplicate", "duplicate_key": all_keys[index]},
            })
            where = "대표 증빙" if index == 0 else f"추가 사진 {index}번"
            return SubmitResponse(
                verified=False,
                reason=f"{where}이 이전에 제출한 자료와 완전히 같습니다. 그 파일만 새로 촬영해 올려 주세요.",
            )

    # 편집해서 파일 해시만 바꾼 재탕 검사 (Gemini 호출 전이라 비용이 들지 않는다)
    phash_distance = None
    if primary_phash and is_video:
        nearest, phash_distance = find_nearest_submission(submission_respository, primary_phash)
        if is_duplicate(phash_distance):
            print(f"pHash 재탕 거절: submission_id={nearest.submission_id} 과 거리 {phash_distance}")
            adjust_trust(current_user, TRUST_ON_REJECT)
            submission_respository.create({
                "user_id": current_user.user_id,
                "quest_id": quest.quest_id,
                "media_url": req.s3_key,
                "media_hash": media_hash,
                "media_embedding": [primary_phash],
                "final_status": SubmissionStatus.REJECTED,
                "ai_verdict": {"verified": False, "reason": "similar_to_past_submission"},
            })
            return SubmitResponse(
                verified=False,
                reason="이전에 제출된 자료와 너무 비슷합니다. 새로 촬영한 자료를 올려 주세요.",
            )

    if not count_daily_use(f"quest_submit:{quest.quest_id}", current_user.user_id, DAILY_SUBMIT_LIMIT):
        return SubmitResponse(
            verified=False,
            reason=f"이 퀘스트는 하루 {DAILY_SUBMIT_LIMIT}번까지 인증할 수 있어요. 내일 다시 시도해 주세요.",
        )

    try:
        response = httpx.post(
            f"{get_setting().AI_SERVICE_URL}/ai/verify-quest",
            json={
                "quest_id": quest.quest_id,
                "quest_title": quest.quest_title,
                "quest_description": quest.quest_description,
                "media_urls": media_urls,
                "is_video": is_video
                },
            timeout=150.0
        )
        response.raise_for_status()
        result: dict = response.json()['data']
    except httpx.HTTPError as error:
        held = submission_respository.create({
            "user_id": current_user.user_id,
            "quest_id": quest.quest_id,
            "media_url": req.s3_key,
            "extra_media_urls": extra_keys,
            "media_type": MediaType.PHOTO if quest.quest_type == QuestType.VOLUNTEER else MediaType.VIDEO,
            "media_hash": media_hash,
            "media_embedding": [primary_phash] if primary_phash else None,
            "ai_verdict": {"reason": "ai_unavailable", "error": type(error).__name__},
            "attempt_number": 1,
            "final_status": SubmissionStatus.ON_HOLD,
            })
        print(f"보류 저장: submission_id={held.submission_id} {type(error).__name__}: {error}")
        return SubmitResponse(
            verified=False,
            reason="지금 검증 서버가 응답하지 않아 접수만 해두었어요. 자동으로 다시 확인하고 결과를 알려드릴게요. 다시 올리지 않으셔도 됩니다.",
            submission_id=held.submission_id,
        )
        
    
    verdict = decide(result, phash_distance, extra_keys)

    # 【판단】 행을 먼저 만들고 settle 이 판정 결과를 채운다. 재시도 작업도
    #        같은 settle 을 쓰므로 보상 규칙이 한 곳에만 있게 된다.
    submission = submission_respository.create({
        "user_id": current_user.user_id,
        "quest_id": quest.quest_id,
        "media_url": req.s3_key,
        "media_type": MediaType.PHOTO if quest.quest_type == QuestType.VOLUNTEER else MediaType.VIDEO,
        "media_hash": media_hash,
        "media_embedding": [primary_phash] if primary_phash else None,
        "attempt_number": 1,
    })
    xp_gained, points_gained, unlocked_badges = settle(
        submission_respository, current_user, quest, submission, verdict, result
    )

    if verdict.challenge:
        print(f"챌린지 발급: submission_id={submission.submission_id} 점수={verdict.suspicion}")
        return SubmitResponse(
            verified=False,
            reason=build_challenge_message(verdict.challenge_code),
            challenge_required=True,
            challenge_code=verdict.challenge_code,
            submission_id=submission.submission_id,
        )

    return SubmitResponse(
        verified=result["verified"],
        reason=result["reason"],
        xp_gained=xp_gained,
        points_gained=points_gained,
        unlocked_badges=unlocked_badges,
    )


@router.post('/challenge', response_model=SubmitResponse)
def submit_challenge(
    req: ChallengeRequest,
    quest_repository: QuestRepository,
    submission_respository: SubmissionRepository,
    current_user: User = Depends(get_current_db_user)
):
    submission = submission_respository.get(req.submission_id)
    if submission is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    # 남의 제출에 답하지 못하게 막는다
    if submission.user_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="본인의 인증만 처리할 수 있습니다.")
    if submission.final_status != SubmissionStatus.PENDING or not submission.challenge_code:
        raise HTTPException(status_code=400, detail="추가 인증이 필요한 제출이 아닙니다.")

    expected_prefix = f"submission/{current_user.user_id}/{submission.quest_id}/"
    if not req.s3_key.startswith(expected_prefix) or ".." in req.s3_key:
        print(f"잘못된 챌린지 경로 거절: user={current_user.user_id} key={req.s3_key}")
        raise HTTPException(status_code=400, detail="잘못된 업로드 경로입니다.")
    media_url = generate_internal_download_url(req.s3_key)
    try:
        response = httpx.post(
            f"{get_setting().AI_SERVICE_URL}/ai/verify-challenge",
            json={"media_url": media_url, "code": submission.challenge_code},
            timeout=60.0,
        )
        response.raise_for_status()
        result: dict = response.json()['data']
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="AI 검증 서버 호출에 실패했습니다.")

    matched = result.get("matched", False)
    submission.challenge_media_url = req.s3_key
    submission.attempt_number = (submission.attempt_number or 1) + 1
    submission.final_status = SubmissionStatus.ACCEPTED if matched else SubmissionStatus.REJECTED

    xp_gained = 0
    points_gained = 0
    unlocked_badges: list[str] = []
    if matched:
        quest = quest_repository.get(submission.quest_id)
        xp_gained, points_gained, unlocked_badges = _grant_reward(
            submission_respository, current_user, quest, submission
        )
    else:
        adjust_trust(current_user, TRUST_ON_REJECT)
        submission_respository.session.commit()



    return SubmitResponse(
        verified=matched,
        reason=result.get("reason", "") if matched
                else "손으로 쓴 인증 번호를 확인하지 못했습니다. 다시 시도해 주세요.",
        xp_gained=xp_gained,
        points_gained=points_gained,
        unlocked_badges=unlocked_badges,
    )