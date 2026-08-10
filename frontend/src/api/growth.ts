import api from './client';

export type DailyXp = {
  date: string;
  cumulative_xp: number | null;
};

export type GrowthStatus = {
  current_level: number;
  current_xp: number;
  next_level_xp: number;
  current_level_floor_xp: number;
  weekly_xp_graph: DailyXp[];
};

export async function getGrowthStatus(): Promise<GrowthStatus> {
  const response = await api.get('/growth/status');
  if (!response.data.success) {
    throw new Error(response.data.message ?? '성장 정보를 불러오지 못했습니다.');
  }
  return response.data.data;
}

export type LeaderboardEntry = {
  rank: number;
  user_id: number;
  nickname: string;
  current_level: number;
  is_me: boolean;
};

export type LeaderboardResponse = {
  leaderboard: LeaderboardEntry[];
  my_entry: LeaderboardEntry;
  nearby_ranks: LeaderboardEntry[];
  total_users: number;
};

export async function getLeaderboard(): Promise<LeaderboardResponse> {
  const response = await api.get('/growth/leaderboard');
  if (!response.data.success) {
    throw new Error(response.data.message ?? '랭킹을 불러오지 못했습니다.');
  }
  return response.data.data;
}