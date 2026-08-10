import api from './client';

export type QuestType = 'VOLUNTEER' | 'GOOD_DEED';
export type Difficulty = 'VERY_EASY' | 'EASY' | 'NORMAL' | 'HARD' | 'VERY_HARD';
export type QuestStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

export type Quest = {
  quest_id: number;
  quest_title: string;
  quest_description: string;
  quest_type: QuestType;
  quest_status: QuestStatus;
  category_code: string;
  category_name: string;
  difficulty: Difficulty;
  reward_point: number | null;
  reward_exp: number | null;
  location: string | null;
  estimated_duration: number | null;
  volunteer_center_id: number | null;
};

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  VERY_EASY: '매우 쉬움',
  EASY: '쉬움',
  NORMAL: '보통',
  HARD: '어려움',
  VERY_HARD: '매우 어려움',
};

/** DiffChip은 한글 라벨을 받으므로 enum을 변환해서 넘긴다. */
export function difficultyLabel(difficulty: Difficulty): string {
  return DIFFICULTY_LABEL[difficulty] ?? '보통';
}

/** GOOD_DEED(개인 선행)는 동영상, VOLUNTEER(봉사)는 VMS 확인서 사진으로 인증한다. */
export function isVideoQuest(questType: QuestType): boolean {
  return questType !== 'VOLUNTEER';
}

// AI 심사는 Gemini 응답을 기다려야 해서 기본 10초로는 모자란다.
// 클라이언트가 먼저 포기하면 서버는 저장까지 마쳤는데 화면엔 실패로 뜬다.
const AI_TIMEOUT = 90000;

/** 커스텀 퀘스트 심사 결과. 거절이면 reason만 채워진다. */
export type QuestJudgement = {
  accepted: boolean;
  reason: string;
  difficulty: Difficulty | null;
  reward_point: number | null;
  reward_exp: number | null;
  quest_id: number | null;
};

/** 등록 전 심사 미리보기. 저장되지 않는다. */
export async function previewQuest(
  questTitle: string, questDescription: string, categoryCode: string
): Promise<QuestJudgement> {
  const response = await api.post('/quests/preview', {
    quest_title: questTitle,
    quest_description: questDescription,
    category_code: categoryCode,
  }, { timeout: AI_TIMEOUT });
  return response.data.data;
}

/** 실제 등록. 보상은 미리보기 값이 아니라 서버가 다시 판정한 값이다. */
export async function createQuest(
  questTitle: string, questDescription: string, categoryCode: string
): Promise<QuestJudgement> {
  const response = await api.post('/quests', {
    quest_title: questTitle,
    quest_description: questDescription,
    category_code: categoryCode,
  }, { timeout: AI_TIMEOUT });
  return response.data.data;
}

export async function getQuests(): Promise<Quest[]> {
  const response = await api.get('/quests');
  return response.data.data ?? [];
}

export async function getQuest(questId: number): Promise<Quest> {
  const response = await api.get(`/quests/${questId}`);
  return response.data.data;
}

/**
 * 퀘스트 포기.
 *
 * 내가 만든 커스텀 퀘스트면 모두에게서 사라지고, 그 외(관리자·남의 것)는
 * 나에게만 안 보이게 된다. 어느 쪽인지는 서버가 정한다.
 * 실제로 지우지 않고 표시만 남기므로 포인트 기록은 그대로 보존된다.
 */
export async function abandonQuest(questId: number): Promise<void> {
  await api.delete(`/quests/${questId}`);
}

/** 퀘스트 시작. 이미 시작한 퀘스트를 다시 시작해도 성공으로 돌아온다. */
export async function startQuest(questId: number): Promise<Quest> {
  const response = await api.post(`/quests/${questId}/start`);
  return response.data.data;
}

/** 오늘 이미 만들어진 추천. 아직 없으면 null이 온다. */
export async function getTodayRecommendation(): Promise<Quest[] | null> {
  const response = await api.get('/quest-recommend/today');
  return response.data.data ?? null;
}

/** 추천 파이프라인을 실제로 실행한다. 좌표가 없으면 서버가 User 테이블 저장 좌표를 쓴다. */
export async function refreshRecommendation(
  latitude?: number | null, longitude?: number | null, requestMessage?: string | null
): Promise<Quest[]> {
  const response = await api.post('/quest-recommend', {
    latitude: latitude ?? null,
    longitude: longitude ?? null,
    request_message: requestMessage ?? null,
  }, { timeout: AI_TIMEOUT });
  return response.data.data ?? [];
}

export async function getOrCreateQuestFromVolunteerCenter(centerId: number): Promise<Quest> {
  const response = await api.post(`/quests/from-volunteer-center/${centerId}`);
  return response.data.data;
}