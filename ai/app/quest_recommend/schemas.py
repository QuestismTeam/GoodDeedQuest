from typing import List, Optional
from pydantic import BaseModel, Field

class QuestRecommendRequest(BaseModel):
    user_id: int = Field(
        ...,
        description="User unique identification ID"
    )
    interests: List[str] = Field(
        default_factory=list,
        description="List of user interest categories (e.g. VOLUNTEER, ENVIRONMENT)"
    )
    region_id: Optional[int] = Field(
        default=None,
        description="Region identification ID"
    )
    latitude: Optional[float] = Field(
        default=None,
        description="Current latitude coordinate"
    )
    longitude: Optional[float] = Field(
        default=None,
        description="Current longitude coordinate"
    )
    level: int = Field(
        default=1,
        description="User level"
    )
    history_quests: List[str] = Field(
        default_factory=list,
        description="Titles of previously completed quests"
    )
    recent_recommendations: List[str] = Field(
        default_factory=list,
        description="Titles of recently recommended quests for deduplication"
    )
    preferred_difficulty: str = Field(
        default="NORMAL",
        description="Preferred difficulty: VERY_EASY, EASY, NORMAL, HARD, VERY_HARD"
    )
    request_message: Optional[str] = Field(
        default=None,
        description="Additional user request or prompt message"
    )


class QuestItemSchema(BaseModel):
    quest_id: Optional[int] = Field(
        default=None,
        description="Quest database primary key ID"
    )
    quest_title: str = Field(
        ...,
        description="Title of the quest"
    )
    quest_description: str = Field(
        ...,
        description="Detailed description and execution guide of the quest"
    )
    quest_type: str = Field(
        ...,
        description="Quest type: 'VOLUNTEER' for real volunteer works, 'GOOD_DEED' for AI-created daily good deeds"
    )
    recommendation_reason: str = Field(
        ...,
        description="AI recommendation reason explaining why this quest was selected"
    )
    category_name: Optional[str] = Field(
        default=None,
        description="Category name (e.g., VOLUNTEER, ENVIRONMENT, SHARING)"
    )
    location: Optional[str] = Field(
        default=None,
        description="Real volunteer activity address. Null for GOOD_DEED quests."
    )
    center_id: Optional[int] = Field(
        default=None,
        description="Source VolunteerCenter ID used to open the original posting screen. Null for GOOD_DEED quests."
    )
    quest_target: Optional[str] = Field(
        default="SOLO",
        description="Participation mode: 'SOLO' or 'TEAM'"
    )
    difficulty: Optional[str] = Field(
        default="NORMAL",
        description="Quest difficulty: VERY_EASY, EASY, NORMAL, HARD, VERY_HARD"
    )
    estimated_duration: Optional[int] = Field(
        default=15,
        description="Estimated duration in minutes"
    )
    priority_score: Optional[int] = Field(
        default=10,
        description="Priority score from 1 to 10 indicating suitability"
    )
    intensity: Optional[int] = Field(
        default=50,
        description="How demanding the quest is within its difficulty (0-100). Used by the backend to compute reward points and exp."
    )


class QuestRecommendResponse(BaseModel):
    success: bool = Field(
        default=True,
        description="Indicates if the API request was successfully processed"
    )
    message: str = Field(
        default="추천 퀘스트가 성공적으로 생성되었습니다.",
        description="Response summary message"
    )
    data: List[QuestItemSchema] = Field(
        ...,
        description="List of top 5 recommended quest objects"
    )


class VolunteerSummaryRequest(BaseModel):
    center_id: int
    vol_title: Optional[str] = None
    vol_name: Optional[str] = None
    target: Optional[str] = None
    vol_act: Optional[str] = None


class VolunteerSummaryResponse(BaseModel):
    quest_title: str
    quest_summary: str