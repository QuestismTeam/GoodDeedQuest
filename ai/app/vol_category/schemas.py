from __future__ import annotations

from typing import List

from pydantic import BaseModel, Field


class RecommendedFacility(BaseModel):

    vol_name: str = Field(..., description="추천 시설(기관)명")
    region_name: str = Field(..., description="추천 시설이 위치한 지역명")


class LackingCategoryCommentRequest(BaseModel):

    region_name: str = Field(..., description="부족 카테고리를 판단한 기준 지역명")
    lacking_category: str = Field(..., description="가장 부족한 봉사 카테고리")
    recommended_facilities: List[RecommendedFacility] = Field(
        default_factory=list,
        description="다른 지역에서 찾은 같은 카테고리 추천 시설 목록 (없을 수도 있음)",
    )


class LackingCategoryComment(BaseModel):

    comment: str = Field(..., description="사용자에게 보여줄 자연어 안내 문구 (1~2문장)")


class LackingCategoryCommentResponse(BaseModel):

    comment: str