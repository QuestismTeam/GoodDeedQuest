from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func
from backend.app.common.database import get_db
from backend.app.common.response import APIResponse
from backend.app.common.auth import get_current_user
from backend.app.map.models import VolunteerCenter, Region, Competition, CompetitionParticipant, CompetitionContribution, City
from backend.app.auth.models import User
from backend.app.map.schemas import VolunteerCenterResponse
from backend.app.map.enums import CompetitionStatus
from backend.app.map.ai_client import VolCategoryCommentAIClient, VolCategoryCommentClientError


router = APIRouter(prefix="/map", tags=["Map Quests"])

ALL_VOLUNTEER_CATEGORIES = ["환경", "동물", "아동청소년", "어르신", "장애인", "교육", "다문화", "재난안전", "지역사회"]


class TeamSelectRequest(BaseModel):
    region_id: int


def _get_current_competition(db: Session, include_settling: bool = False) -> Competition | None:
    statuses = [CompetitionStatus.IN_PROGRESS]
    if include_settling:
        statuses.append(CompetitionStatus.SETTLING)
    return (
        db.query(Competition)
        .filter(Competition.status.in_(statuses))
        .order_by(Competition.start_at.desc())
        .first()
    )


def _ensure_participant(db: Session, competition_id: int, region_id: int) -> None:
    exists = (
        db.query(CompetitionParticipant)
        .filter(
            CompetitionParticipant.competition_id == competition_id,
            CompetitionParticipant.region_id == region_id,
        )
        .first()
    )
    if exists is None:
        db.add(CompetitionParticipant(competition_id=competition_id, region_id=region_id, score=0))
        db.commit()


def initialize_all_participants(db: Session, competition_id: int) -> None:
    all_region_ids = db.query(Region.region_id).all()
    for (region_id,) in all_region_ids:
        _ensure_participant(db, competition_id, region_id)


@router.get("/main")
def get_map_main(
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    db_user = db.query(User).filter(User.user_id == user["id"]).first()

    if db_user is None or db_user.region_id is None:
        return APIResponse.ok(data={"has_region": False, "region": None})

    region = db.query(Region).filter(Region.region_id == db_user.region_id).first()

    competition = _get_current_competition(db, include_settling=False)
    if competition is not None:
        _ensure_participant(db, competition.competition_id, db_user.region_id)

    return APIResponse.ok(data={
        "has_region": True,
        "region": {
            "region_id": region.region_id,
            "region_name": region.region_name,
            "city_id": region.city_id,
        },
    })


@router.get("/cities/{city_id}/regions")
def get_regions_by_city(
    city_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    regions = (
        db.query(Region)
        .filter(Region.city_id == city_id)
        .order_by(Region.region_name)
        .all()
    )
    return APIResponse.ok(data=[
        {"region_id": r.region_id, "region_name": r.region_name} for r in regions
    ])


@router.get("/volunteer-centers", response_model=APIResponse[List[VolunteerCenterResponse]])
def get_nearby_volunteer_centers(
    lat: float = Query(..., description="내 위치 위도"),
    lng: float = Query(..., description="내 위치 경도"),
    radius_km: float = Query(3.0, description="반경(km)"),
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    delta = radius_km / 111

    centers = (
        db.query(VolunteerCenter)
        .filter(
            VolunteerCenter.latitude.isnot(None),
            VolunteerCenter.longitude.isnot(None),
            VolunteerCenter.latitude.between(lat - delta, lat + delta),
            VolunteerCenter.longitude.between(lng - delta, lng + delta),
        )
        .all()
    )

    return APIResponse.ok(data=centers, message=f"반경 {radius_km}km 내 봉사센터 조회 성공")


@router.get("/volunteer-centers/{center_id}", response_model=APIResponse[VolunteerCenterResponse])
def get_volunteer_center(
    center_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    center = db.query(VolunteerCenter).filter(VolunteerCenter.center_id == center_id).first()
    if not center:
        raise HTTPException(status_code=404, detail="봉사 공고를 찾을 수 없습니다.")

    return APIResponse.ok(data=center, message="봉사 공고 조회 성공")


@router.get("/national-ranking")
def get_national_ranking(
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    competition = _get_current_competition(db, include_settling=True)
    if competition is None:
        return APIResponse.fail(message="진행 중이거나 정산 중인 대항전이 없습니다")

    results = (
        db.query(
            City.city_id,
            City.city_name,
            func.coalesce(func.sum(CompetitionContribution.points), 0).label("total_score"),
        )
        .join(Region, Region.city_id == City.city_id)
        .join(CompetitionParticipant, CompetitionParticipant.region_id == Region.region_id)
        .outerjoin(
            CompetitionContribution,
            (CompetitionContribution.region_id == Region.region_id)
            & (CompetitionContribution.competition_id == competition.competition_id),
        )
        .filter(CompetitionParticipant.competition_id == competition.competition_id)
        .group_by(City.city_id, City.city_name)
        .order_by(func.coalesce(func.sum(CompetitionContribution.points), 0).desc())
        .all()
    )

    ranking = [
        {"rank": idx + 1, "city_id": r.city_id, "city_name": r.city_name, "total_score": r.total_score}
        for idx, r in enumerate(results)
    ]
    return APIResponse.ok(data={"competition_id": competition.competition_id, "ranking": ranking})


@router.get("/city-ranking/{city_id}")
def get_city_ranking(
    city_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    competition = _get_current_competition(db, include_settling=True)
    if competition is None:
        return APIResponse.fail(message="진행 중이거나 정산 중인 대항전이 없습니다")

    participating_regions = (
        db.query(Region.region_id, Region.region_name)
        .join(CompetitionParticipant, CompetitionParticipant.region_id == Region.region_id)
        .filter(
            Region.city_id == city_id,
            CompetitionParticipant.competition_id == competition.competition_id,
        )
        .all()
    )
    region_ids = [r.region_id for r in participating_regions]

    contribution_totals = dict(
        db.query(
            CompetitionContribution.region_id,
            func.coalesce(func.sum(CompetitionContribution.points), 0),
        )
        .filter(
            CompetitionContribution.competition_id == competition.competition_id,
            CompetitionContribution.region_id.in_(region_ids),
        )
        .group_by(CompetitionContribution.region_id)
        .all()
    ) if region_ids else {}

    participant_counts = dict(
        db.query(User.region_id, func.count(User.user_id))
        .filter(User.region_id.in_(region_ids))
        .group_by(User.region_id)
        .all()
    ) if region_ids else {}

    scored = []
    for r in participating_regions:
        participant_count = participant_counts.get(r.region_id, 0)
        score = contribution_totals.get(r.region_id, 0)
        average_score = round(score / participant_count, 1) if participant_count > 0 else 0
        scored.append({
            "region_id": r.region_id,
            "region_name": r.region_name,
            "score": score,
            "participant_count": participant_count,
            "average_score": average_score,
        })

    scored.sort(key=lambda x: (x["average_score"], x["participant_count"]), reverse=True)

    ranking = [{"rank": idx + 1, **item} for idx, item in enumerate(scored)]
    return APIResponse.ok(data={"city_id": city_id, "competition_id": competition.competition_id, "ranking": ranking})


@router.get("/region-ranking/{region_id}")
def get_region_detail_ranking(
    region_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    competition = _get_current_competition(db, include_settling=True)
    if competition is None:
        return APIResponse.fail(message="진행 중이거나 정산 중인 대항전이 없습니다")

    region = db.query(Region).filter(Region.region_id == region_id).first()
    if region is None:
        return APIResponse.fail(message="존재하지 않는 지역입니다")

    personal_results = (
        db.query(
            User.user_id,
            User.nickname,
            func.coalesce(func.sum(CompetitionContribution.points), 0).label("total_points"),
        )
        .join(CompetitionContribution, CompetitionContribution.user_id == User.user_id)
        .filter(
            CompetitionContribution.competition_id == competition.competition_id,
            CompetitionContribution.region_id == region_id,
        )
        .group_by(User.user_id, User.nickname)
        .order_by(func.sum(CompetitionContribution.points).desc())
        .all()
    )

    personal_ranking = [
        {
            "rank": idx + 1,
            "user_id": r.user_id,
            "nickname": r.nickname,
            "score": r.total_points,
            "is_me": r.user_id == user["id"],
        }
        for idx, r in enumerate(personal_results)
    ]

    raw_counts = dict(
        db.query(VolunteerCenter.ai_category, func.count(VolunteerCenter.center_id))
        .filter(VolunteerCenter.region_id == region_id, VolunteerCenter.ai_category.isnot(None))
        .group_by(VolunteerCenter.ai_category)
        .all()
    )
    category_counts = {cat: raw_counts.get(cat, 0) for cat in ALL_VOLUNTEER_CATEGORIES}
    lacking_category = min(category_counts, key=category_counts.get)

    recommended = (
        db.query(VolunteerCenter, Region.region_name)
        .join(Region, Region.region_id == VolunteerCenter.region_id)
        .filter(
            VolunteerCenter.ai_category == lacking_category,
            VolunteerCenter.region_id != region_id,
            Region.city_id == region.city_id,
        )
        .limit(3)
        .all()
    )

    recommended_facilities = [
        {
            "center_id": f.center_id,
            "vol_name": f.vol_name,
            "ai_category": f.ai_category,
            "region_id": f.region_id,
            "region_name": facility_region_name,
        }
        for f, facility_region_name in recommended
    ]

    try:
        lacking_category_comment = VolCategoryCommentAIClient().request_comment(
            payload={
                "region_name": region.region_name,
                "lacking_category": lacking_category,
                "recommended_facilities": [
                    {"vol_name": rf["vol_name"], "region_name": rf["region_name"]}
                    for rf in recommended_facilities
                ],
            }
        )
    except VolCategoryCommentClientError:
        lacking_category_comment = (
            f"{region.region_name}은(는) 다른 지역에 비해 '{lacking_category}' 관련 봉사가 부족해요."
        )

    return APIResponse.ok(data={
        "region_id": region_id,
        "region_name": region.region_name,
        "competition_id": competition.competition_id,
        "personal_ranking": personal_ranking,
        "lacking_category": lacking_category,
        "lacking_category_comment": lacking_category_comment,
        "recommended_facilities": recommended_facilities,
    })


@router.post("/team-select")
def select_competition_team(
    payload: TeamSelectRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    db_user = db.query(User).filter(User.user_id == user["id"]).first()
    if db_user is None:
        return APIResponse.fail(message="사용자를 찾을 수 없습니다")

    is_first_selection = db_user.region_id is None

    if is_first_selection:
        competition = _get_current_competition(db, include_settling=True)
    else:
        competition = (
            db.query(Competition)
            .filter(Competition.status == CompetitionStatus.SETTLING)
            .order_by(Competition.start_at.desc())
            .first()
        )
        if competition is None:
            return APIResponse.fail(message="팀 변경은 정산 중(다음 대회 준비 기간)에만 가능합니다")

    if competition is None:
        return APIResponse.fail(message="진행 중이거나 정산 중인 대항전이 없습니다")

    region = db.query(Region).filter(Region.region_id == payload.region_id).first()
    if region is None:
        return APIResponse.fail(message="존재하지 않는 지역입니다")

    db_user.region_id = payload.region_id
    db.commit()

    if competition.status == CompetitionStatus.IN_PROGRESS:
        _ensure_participant(db, competition.competition_id, payload.region_id)

    db.refresh(db_user)

    return APIResponse.ok(
        data={
            "region_id": db_user.region_id,
            "region_name": region.region_name,
            "competition_id": competition.competition_id,
        },
        message="참여 지역이 설정되었습니다",
    )