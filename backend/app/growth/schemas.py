from datetime import date as date_type
from typing import List, Optional
from pydantic import BaseModel, ConfigDict


class DailyXp(BaseModel):
    date: date_type
    cumulative_xp: Optional[int] = None


class GrowthStatusResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    current_level: int
    current_xp: int
    next_level_xp: int
    current_level_floor_xp: int
    weekly_xp_graph: List[DailyXp]


class LeaderboardEntry(BaseModel):
    rank: int
    user_id: int
    nickname: str
    current_level: int
    is_me: bool = False


class LeaderboardResponse(BaseModel):
    leaderboard: List[LeaderboardEntry]
    my_entry: LeaderboardEntry
    nearby_ranks: List[LeaderboardEntry]
    total_users: int