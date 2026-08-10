/**
 * SCREEN 08-4 · 숏폼 생성 로딩 (route: Generating — fade in, no back while generating).
 * 진입 시 /generate 호출 후 /status를 20초 간격으로, 최대 MAX_POLL_DURATION_MS까지 폴링한다.
 * COMPLETED면 Player로 replace, FAILED면 error_message를 보여주고 뒤로 갈 수 있게 한다.
 * 그 시간이 지나도 안 끝나면 폴링을 멈추고 타임아웃 에러로 전환한다(워커가 죽는 등
 * 서버 쪽 문제로 상태가 영영 안 바뀔 때 클라이언트가 무한 폴링하는 것을 막기 위함).
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Animated, { FadeIn } from 'react-native-reanimated';
import HazeBackground from '../../components/HazeBackground';
import MainHeader from '../../components/MainHeader';
import SpringButton from '../../components/SpringButton';
import { colors, fonts } from '../../theme';
import { GeneratingProgressBar } from './_parts'; // ⭐ 수정: 원형 스피너 제거, 진행 바만 사용
import { createShortform, generateScript, generateVideo, getShortformStatus, CaptionItem } from '../../api/shortform';

const POLL_INTERVAL_MS = 20000;
// ⭐ 추가: 렌더링이 이 시간 안에 안 끝나면(워커 다운 등 비정상 상황) 폴링을 멈추고
// 타임아웃 에러로 전환한다 - 상한이 없으면 서버가 응답 못 하는 상태에서도 클라이언트가
// 화면을 닫을 때까지 영원히 요청을 계속 보내게 된다.
const MAX_POLL_DURATION_MS = 5 * 60 * 1000; // 5분

// ⭐ 수정: 기존엔 폴링 틱(4초)마다 한 단계씩 넘어가는 연출이라, 4틱(16초)만 지나면
// 진행바가 100%를 찍어버리고 그 뒤로 실제 렌더링이 한참 더 걸려도 그대로 멈춰 있었다
// (AI 대본 팝업과 똑같은 문제 - _parts.tsx의 ScriptGeneratingStatus와 동일한 방식으로
// 고친다). 실제 경과 시간을 기준으로 단계 문구와 진행률을 계산해서, 오래 걸려도
// "멈춘 게 아니다"와 대략 어느 단계인지를 계속 보여준다.
// 수동("생성하기")은 대본/음악이 이미 정해진 채로 들어와서 렌더링 단계만 겪는다.
const RENDER_STAGES = [
  { atSeconds: 0, label: '요청을 접수하고 있어요...' },
  { atSeconds: 5, label: '자막과 배경음악을 확인하고 있어요...' },
  { atSeconds: 15, label: '장면을 이어붙이고 있어요...' },
  { atSeconds: 30, label: '영상을 렌더링하고 있어요...' },
  { atSeconds: 90, label: '생각보다 오래 걸리고 있어요, 조금만 더 기다려주세요...' },
] as const;

// ⭐ 추가: "자동생성"은 이 화면에 들어온 뒤에 AI 대본 생성 + 음악 매칭까지 처음부터
// 진행하므로(예전엔 이 작업을 사진 선택 화면에 머문 채로 끝내서 화면이 멈춘 것처럼
// 보였음) 그 앞단계를 포함한 문구를 쓴다.
const AUTO_STAGES = [
  { atSeconds: 0, label: 'AI가 사진 속 장면을 분석하고 있어요...' },
  { atSeconds: 8, label: '대본과 어울리는 음악을 고르고 있어요...' },
  { atSeconds: 25, label: '자막과 배경음악을 확인하고 있어요...' },
  { atSeconds: 40, label: '장면을 이어붙이고 있어요...' },
  { atSeconds: 60, label: '영상을 렌더링하고 있어요...' },
  { atSeconds: 120, label: '생각보다 오래 걸리고 있어요, 조금만 더 기다려주세요...' },
] as const;

// 실제 진행률이 아니라 경과 시간을 0~92%로 점근시키는 연출용 진행바(AI 대본 팝업과 동일한 공식) -
// 자동생성은 대본 생성까지 포함해서 더 오래 걸리므로 시간상수를 더 길게 잡는다.
const RENDER_PROGRESS_TIME_CONSTANT_SECONDS = 45;
const AUTO_PROGRESS_TIME_CONSTANT_SECONDS = 70;

export default function GeneratingScreen({ navigation, route }: any) {
  const isAuto: boolean = !!route?.params?.auto;
  const shortsId: number | undefined = route?.params?.shortsId;
  const mediaKeys: string[] = route?.params?.mediaKeys ?? [];
  const captions: CaptionItem[] | null = route?.params?.captions ?? null;
  const questTitle: string = route?.params?.questTitle ?? route?.params?.title ?? '나의 선행 숏폼';
  const matchedBgmId: number | null = route?.params?.matchedBgmId ?? null;

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0); // ⭐ 수정: 단계 문구/진행률을 경과 시간 기준으로 계산
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;

    const startedAt = Date.now();
    setElapsedMs(0);
    elapsedTimer.current = setInterval(() => setElapsedMs(Date.now() - startedAt), 200);

    const stopPolling = () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };

    const startPolling = (pollShortsId: number) => {
      pollTimer.current = setInterval(async () => {
        if (Date.now() - startedAt >= MAX_POLL_DURATION_MS) {
          stopPolling();
          if (!stopped.current) {
            setErrorMessage('영상 생성이 너무 오래 걸리고 있어요. 잠시 후 다시 시도해주세요.');
          }
          return;
        }

        try {
          const result = await getShortformStatus(pollShortsId);
          if (stopped.current) return;
          if (result.status === 'COMPLETED') {
            stopPolling();
            navigation.replace('Player', { videoUrl: result.video_url, shortsId: pollShortsId });
          } else if (result.status === 'FAILED') {
            stopPolling();
            setErrorMessage(result.error_message ?? '영상 생성에 실패했습니다.');
          }
          // 진행 중이면 아무것도 안 함 - 단계 문구/진행률은 elapsedMs 타이머가 계속 계산한다.
        } catch {
          // ⭐ 수정(이슈 #196 원인 파악 완료, 진단 로그 제거): 폴링 중 일시적 네트워크
          // 오류(백엔드 개발 서버 reload로 인한 순간적 연결 끊김 등)는 다음 폴링 틱에서
          // 자연히 재시도되어 회복되므로 실패가 아니다. console.error/warn 둘 다 Expo/RN의
          // LogBox를 통해 화면에 에러 배너로 노출되어 사용자에게 혼란을 주므로 아무것도
          // 로그하지 않고 조용히 다음 틱을 기다린다.
        }
      }, POLL_INTERVAL_MS);
    };

    (async () => {
      if (mediaKeys.length === 0) {
        setErrorMessage('선택된 사진이 없습니다. 이전 화면에서 다시 시도해주세요.');
        return;
      }

      try {
        let finalShortsId = shortsId;
        let finalCaptions = captions;

        if (isAuto) {
          // ⭐ 추가: 자동생성 - 저장된 대본이 없으면(또는 사진이 바뀌어 초기화됐으면) 여기서
          // 직접 만든다. bgm_id는 아직 모르니 임시 shorts_id 확보용으로만 undefined로
          // 만들고, 매칭된 값으로 아래서 다시 만든다.
          let finalTitle = questTitle;
          let matchedBgm = matchedBgmId;

          if (!finalCaptions || finalCaptions.length === 0) {
            const draft = await createShortform(questTitle, mediaKeys, undefined);
            const scriptResult = await generateScript(draft.shorts_id, mediaKeys, questTitle);
            finalCaptions = scriptResult.captions;
            finalTitle = scriptResult.title || questTitle;
            matchedBgm = scriptResult.bgm_id ?? null;
          }

          // 최종 제목/BGM으로 다시 생성한다 - draft는 임시값(제목 placeholder, bgm 더미)이라
          // 실제 반영하려면 다시 만들어야 함(ShortForm에 title/bgm_id 수정 API가 없음).
          const finalForm = await createShortform(finalTitle, mediaKeys, matchedBgm ?? undefined);
          finalShortsId = finalForm.shorts_id;
        } else if (!finalShortsId || !finalCaptions || finalCaptions.length === 0) {
          // 수동("생성하기") 경로는 사진 선택 화면에서 이미 shortsId/captions를 만들어서
          // 넘겨줘야 한다 - 없으면 이전 단계(AI 대본)가 빠진 것이므로 여기서 걸러낸다.
          setErrorMessage('대본이 준비되지 않았습니다. 이전 화면에서 AI 자막을 먼저 생성해주세요.'); // ⭐ 수정: "AI 대본" → "AI 자막"
          return;
        }

        await generateVideo(finalShortsId as number, mediaKeys, finalCaptions as CaptionItem[]);
        if (stopped.current) return;
        startPolling(finalShortsId as number);
      } catch (error: any) {
        console.error('영상 생성 요청 실패:', error);
        const detail = error?.response?.data?.detail;
        setErrorMessage(typeof detail === 'string' ? detail : '영상 생성 요청에 실패했습니다.');
      }
    })();

    return () => {
      stopped.current = true;
      stopPolling();
      if (elapsedTimer.current) clearInterval(elapsedTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuto, shortsId]);

  const stages = isAuto ? AUTO_STAGES : RENDER_STAGES;
  const progressTimeConstant = isAuto ? AUTO_PROGRESS_TIME_CONSTANT_SECONDS : RENDER_PROGRESS_TIME_CONSTANT_SECONDS;
  const elapsedSeconds = elapsedMs / 1000;
  const stage = stages.reduce(
    (acc: (typeof stages)[number], s) => (elapsedSeconds >= s.atSeconds ? s : acc),
    stages[0],
  );
  const progress = Math.min(0.92, 1 - Math.exp(-elapsedSeconds / progressTimeConstant));

  if (errorMessage) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <HazeBackground />
        <MainHeader showBack onBack={() => navigation.goBack()} />

        <Animated.View entering={FadeIn.duration(260)} style={styles.center}>
          <Text style={styles.errorTitle}>영상 생성에 실패했습니다</Text>
          <Text style={styles.errorSub}>{errorMessage}</Text>
          <SpringButton onPress={() => navigation.goBack()} style={styles.retryBtn}>
            <Text style={styles.retryText}>돌아가기</Text>
          </SpringButton>
        </Animated.View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <HazeBackground />
      <MainHeader />

      {/* ⭐ 수정: 원형 스피너 제거 — 텍스트 + 진행 바만 화면 중앙에 배치 */}
      <Animated.View entering={FadeIn.duration(260)} style={styles.center}>
        <Text style={styles.title}>영상을 생성하는 중입니다...</Text>
        <Text style={styles.sub}>{stage.label}</Text>
        <GeneratingProgressBar progress={progress} />
        <Text style={styles.elapsed}>약 {Math.floor(elapsedSeconds)}초 경과</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  title: { fontFamily: fonts.pixel, fontSize: 16, color: colors.primaryDark, marginBottom: 8 }, // ⭐ 수정: 스피너 제거로 marginTop 불필요
  sub: { fontSize: 12, color: '#888', textAlign: 'center', fontFamily: fonts.bodyR },
  elapsed: { marginTop: 10, fontSize: 11, color: '#AAA', fontFamily: fonts.bodyR },

  errorTitle: { fontFamily: fonts.pixel, fontSize: 16, color: colors.danger, marginBottom: 10, textAlign: 'center' },
  errorSub: { fontSize: 13, color: '#888', textAlign: 'center', fontFamily: fonts.bodyR, marginBottom: 24, lineHeight: 20 },
  retryBtn: {
    height: 46,
    minWidth: 160,
    borderRadius: 8,
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  retryText: { fontFamily: fonts.pixel, fontSize: 15, color: colors.parchment },
});
