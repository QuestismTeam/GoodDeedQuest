"""보류(ON_HOLD) 제출 자동 재판정.

AI 서버 장애로 판정하지 못한 제출을 10분마다 다시 시도한다.
6회(약 1시간) 실패하면 포기하고 거절로 확정한다. 포기해도 사용자는
같은 파일을 그대로 다시 낼 수 있다 — 중복 검사가 ACCEPTED 만 세기 때문이다.
"""
import logging

import httpx

from backend.app.challenge.celery_app import celery_app
from backend.app.common.config import get_setting
from backend.app.common.database import SessionLocal
from backend.app.common.repository import DatabaseRepository
from backend.app.common.s3_client import generate_internal_download_url
from backend.app.auth.models import User
from backend.app.quest.models import Quest
from backend.app.quest.enums import QuestType
from backend.app.quest_verification.enums import SubmissionStatus
from backend.app.quest_verification.models import QuestSubmission
from backend.app.quest_verification.verdict import decide, settle

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 6   # 10분 간격 × 6회 ≈ 1시간


@celery_app.task(name="quest_verification.retry_held_submissions", queue="maintenance")
def retry_held_submissions() -> int:
    """보류 중인 제출을 다시 판정한다.

    Returns:
        이번 실행에서 확정된(통과·거절·챌린지) 제출 건수
    """
    session = SessionLocal()
    settled = 0
    try:
        repo = DatabaseRepository(QuestSubmission, session)
        held = repo.filter(QuestSubmission.final_status == SubmissionStatus.ON_HOLD)

        for submission in held:
            attempts = (submission.attempt_number or 1) + 1

            # 【기능】 상한을 넘으면 포기하고 거절로 확정한다. 안 그러면 보류 행이
            #        영원히 남아 10분마다 AI 를 계속 부른다.
            if attempts > MAX_ATTEMPTS:
                submission.final_status = SubmissionStatus.REJECTED
                submission.attempt_number = attempts
                submission.ai_verdict = {
                    "verified": False,
                    "reason": "검증 서버 장애로 판정하지 못했습니다. 다시 제출해 주세요.",
                }
                settled += 1
                logger.warning("보류 포기: submission_id=%s (%s회 실패)",
                               submission.submission_id, MAX_ATTEMPTS)
                continue

            quest = session.get(Quest, submission.quest_id)
            user = session.get(User, submission.user_id)
            if quest is None or user is None:
                submission.final_status = SubmissionStatus.REJECTED
                submission.attempt_number = attempts
                submission.ai_verdict = {"verified": False, "reason": "퀘스트 또는 사용자를 찾을 수 없습니다."}
                settled += 1
                continue

            keys = [submission.media_url] + list(submission.extra_media_urls or [])
            try:
                response = httpx.post(
                    f"{get_setting().AI_SERVICE_URL}/ai/verify-quest",
                    json={
                        "quest_id": quest.quest_id,
                        "quest_title": quest.quest_title,
                        "quest_description": quest.quest_description,
                        "media_urls": [generate_internal_download_url(k) for k in keys],
                        "is_video": quest.quest_type != QuestType.VOLUNTEER,
                    },
                    timeout=90.0,
                )
                response.raise_for_status()
                result: dict = response.json()["data"]
            except httpx.HTTPError as error:
                # 【판단】 아직 안 살아났다. 횟수만 올리고 다음 차례를 기다린다.
                submission.attempt_number = attempts
                logger.info("보류 재시도 실패: submission_id=%s (%s/%s) %s",
                            submission.submission_id, attempts, MAX_ATTEMPTS,
                            type(error).__name__)
                continue

            submission.attempt_number = attempts
            # 【판단】 phash_distance 를 None 으로 넘긴다. 재시도 시점에 다시 재려면
            #        전체 제출을 훑어야 하는데, 첫 제출 때 이미 차단 검사를 통과한
            #        건이라 회색지대 가산점(+2)만 빠진다. 판정이 느슨해지는 쪽이다.
            verdict = decide(result, None, keys[1:])
            settle(repo, user, quest, submission, verdict, result)
            settled += 1

        session.commit()
        return settled
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()