import api from './client';

export type CityRankingEntry = {
  rank: number;
  region_id: number;
  region_name: string;
  score: number;
  participant_count: number;
  average_score: number;
};

export type CityRankingResponse = {
  city_id: number;
  competition_id: number;
  ranking: CityRankingEntry[];
};

export async function getCityRanking(cityId: number): Promise<CityRankingResponse> {
  const response = await api.get(`/map/city-ranking/${cityId}`);
  if (!response.data.success) {
    throw new Error(response.data.message ?? '랭킹을 불러오지 못했습니다.');
  }
  return response.data.data;
}

export type NationalRankingEntry = {
  rank: number;
  city_id: number;
  city_name: string;
  total_score: number;
};

export type NationalRankingResponse = {
  competition_id: number;
  ranking: NationalRankingEntry[];
};

export async function getNationalRanking(): Promise<NationalRankingResponse> {
  const response = await api.get('/map/national-ranking');
  if (!response.data.success) {
    throw new Error(response.data.message ?? '랭킹을 불러오지 못했습니다.');
  }
  return response.data.data;
}

export type PersonalRankingEntry = {
  rank: number;
  user_id: number;
  nickname: string;
  score: number;
  is_me: boolean;
};

export type RecommendedFacility = {
  center_id: number;
  vol_name: string;
  ai_category: string;
  region_id: number;
  region_name: string;
};

export type RegionRankingResponse = {
  region_id: number;
  region_name: string;
  competition_id: number;
  personal_ranking: PersonalRankingEntry[];
  lacking_category: string;
  lacking_category_comment: string;
  recommended_facilities: RecommendedFacility[];
};

export async function getRegionRanking(regionId: number): Promise<RegionRankingResponse> {
  const response = await api.get(`/map/region-ranking/${regionId}`);
  if (!response.data.success) {
    throw new Error(response.data.message ?? '랭킹을 불러오지 못했습니다.');
  }
  return response.data.data;
}

export type VolunteerCenter = {
  center_id: number;
  region_id: number;
  vol_name: string | null;
  vol_address: string | null;
  vol_title: string | null;
  target: string | null;
  vms_url: string | null;
  vol_qual: string | null;
  vol_act: string | null;
  vol_date: string | null;
  latitude: number | null;
  longitude: number | null;
  updated_at: string;
};

export async function getNearbyVolunteerCenters(lat: number, lng: number, radiusKm = 3): Promise<VolunteerCenter[]> {
  const response = await api.get('/map/volunteer-centers', { params: { lat, lng, radius_km: radiusKm } });
  return response.data.data ?? [];
}

export async function getVolunteerCenter(centerId: number): Promise<VolunteerCenter> {
  const response = await api.get(`/map/volunteer-centers/${centerId}`);
  return response.data.data;
}

export type RegionOption = {
  region_id: number;
  region_name: string;
};

export async function getRegionsByCity(cityId: number): Promise<RegionOption[]> {
  const response = await api.get(`/map/cities/${cityId}/regions`);
  return response.data.data ?? [];
}

export type MapMainResponse = {
  has_region: boolean;
  region: { region_id: number; region_name: string; city_id: number } | null;
};

export async function getMapMain(): Promise<MapMainResponse> {
  const response = await api.get('/map/main');
  return response.data.data;
}

export type TeamSelectResult = {
  region_id: number;
  region_name: string;
  competition_id: number;
};

export async function selectTeamRegion(regionId: number): Promise<TeamSelectResult> {
  const response = await api.post('/map/team-select', { region_id: regionId });
  if (!response.data.success) {
    throw new Error(response.data.message ?? '참여 지역을 설정하지 못했습니다.');
  }
  return response.data.data;
}