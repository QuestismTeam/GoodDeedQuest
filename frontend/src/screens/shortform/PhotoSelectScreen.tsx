/**
 * SCREEN 08-1 · 사진 선택 및 상세설정 (route: PhotoSelect — Shortform stack ROOT,
 * reached from the drawer). MainHeader (no back, hamburger) + haze bg.
 * 기간 필터 칩 · 인증 사진 3열 그리드(다중 선택, 골드 체크 배지) · N장 선택됨.
 * Footer: AI 대본 / 음악 → 각 오버레이, 생성하기·자동생성 → Generating.
 * Motion: grid cells stagger-pop (ZoomIn.delay), chips/buttons spring press.
 *
 * 사진 그리드는 새로 촬영/업로드하는 사진이 아니라, 이미 승인된 "퀘스트 인증 사진"
 * 중에서 골라 숏폼 소재로 쓴다 (short_form.schemas.ScriptGenerateRequest 문서 기준).
 * GET /shortforms/eligible-media(getEligibleMedia)로 조회 — 썸네일 표시용
 * media_url(presigned URL)과 숏폼 생성 요청용 media_s3_key(원본 S3 key)가
 * 분리되어 내려온다.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Image,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { ZoomIn } from 'react-native-reanimated';
import HazeBackground from '../../components/HazeBackground';
import MainHeader from '../../components/MainHeader';
import SpringButton from '../../components/SpringButton';
import { CheckMark } from '../../components/PixelIcons';
import { useToast } from '../../components/Toast';
import { colors, fonts } from '../../theme';
import { AiScriptPopup, MusicSheet, PlayTri } from './_parts';
import { consumePlayerShown } from './completionFlag';
import { getQuest } from '../../api/quest';
import {
  createShortform,
  getEligibleMedia,
  CaptionItem,
  BackgroundMusic,
  EligibleMedia,
} from '../../api/shortform';

const PERIODS = ['전체', '이번주', '1주전', '2주전', '3주전'];
const PERIOD_DAYS: (number | null)[] = [null, 7, 14, 21, 28];
const DEFAULT_TITLE = '나의 선행 숏폼';
// ⭐ 추가: 백엔드 short_form/service.py의 MAX_CAPTION_COUNT(캡션 개수 상한)와 동일한 값.
// 여기서 선택 자체를 막아야, 다 고르고 "AI 대본 생성"을 누른 뒤에야 개수 초과로
// 거부당하는(그마저도 예전엔 AI 서버가 사진을 전부 분석한 "뒤"에 실패해서 시간만
// 낭비하던) 상황을 미리 방지할 수 있다.
const MAX_MEDIA_SELECTION = 20;

export default function PhotoSelectScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const toast = useToast();

  const [period, setPeriod] = useState(0);
  const [submissions, setSubmissions] = useState<EligibleMedia[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(true);
  const [submissionsError, setSubmissionsError] = useState<string | null>(null);
  // ⭐ 수정: 제출 1건이 여러 사진(보조 사진 + 동영상 대표 프레임)으로 풀려 나올 수 있어
  // submission_id는 더 이상 화면 내에서 유일하지 않다 - 사진마다 고유한 media_s3_key로 선택 관리.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [scriptOpen, setScriptOpen] = useState(false);
  const [musicOpen, setMusicOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [autoGenerating, setAutoGenerating] = useState(false);

  // short_form 레코드는 생성 시점의 title/bgm_id가 그대로 굳어버려서(수정 API 없음),
  // 대본/음악 팝업 중 먼저 여는 쪽에서 shortsId를 미리 확보해 AI 대본 호출에 쓴다.
  // 이후 "생성하기" 시점에 실제 선택된 title/bgm과 어긋나 있으면 그때 다시 생성해서
  // 최종 값을 반영한다 (대본을 먼저 하든 음악을 먼저 하든 둘 다 최종적으로 반영되게).
  const [shortsId, setShortsId] = useState<number | null>(null);
  const [shortsIdBgmId, setShortsIdBgmId] = useState<number | undefined>(undefined);
  const [shortsIdTitle, setShortsIdTitle] = useState<string | undefined>(undefined);
  const [selectedBgm, setSelectedBgm] = useState<BackgroundMusic | null>(null);
  const [captions, setCaptions] = useState<CaptionItem[] | null>(null);
  const [scriptTitle, setScriptTitle] = useState<string | null>(null);
  // ⭐ 수정: AI 서버가 사진 분위기 기반으로 매칭한 BGM ("자동생성" 전용). captions와
  // 마찬가지로 사진 선택이 바뀌면 더 이상 유효하지 않으므로 함께 초기화된다.
  const [autoBgmId, setAutoBgmId] = useState<number | null>(null);
  const questTitleCache = React.useRef<Map<number, string>>(new Map());

  // ⭐ 수정: 생성 완료(PlayerScreen)를 보고 돌아오면 처음부터 다시 선택할 수 있도록
  // 사진 선택/AI 대본/음악/기간 필터를 전부 초기 상태로 되돌린다. 예전엔 PlayerScreen이
  // 나가는 시점에 route params로 reset 신호를 실어 보내는 방식이었는데, 버튼/스와이프
  // 제스처/하드웨어 뒤로가기/드로어 메뉴 등 "나가는 경로"마다 신호를 놓치기 쉬웠다
  // (완전히 가로채려던 시도는 무한 재귀 크래시까지 났음). 대신 PlayerScreen이 "보여졌다"는
  // 사실만 completionFlag에 기록해두고, 이 화면이 포커스를 되찾을 때마다(나가는 경로와
  // 무관하게 항상 호출되는 useFocusEffect) 그 기록을 확인해서 초기화한다.
  useFocusEffect(
    useCallback(() => {
      if (!consumePlayerShown()) return;
      setPeriod(0);
      setSelectedIds([]);
      setScriptOpen(false);
      setMusicOpen(false);
      setShortsId(null);
      setShortsIdBgmId(undefined);
      setShortsIdTitle(undefined);
      setSelectedBgm(null);
      setCaptions(null);
      setScriptTitle(null);
      setAutoBgmId(null);
    }, []),
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoadingSubmissions(true);
        setSubmissionsError(null);
        const result = await getEligibleMedia(0, 100);
        if (!mounted) return;
        setSubmissions(
          result.filter(
            (item): item is EligibleMedia & { media_url: string; media_s3_key: string } =>
              typeof item.media_url === 'string' &&
              item.media_url.trim().length > 0 &&
              typeof item.media_s3_key === 'string' &&
              item.media_s3_key.trim().length > 0,
          ),
        );
      } catch (error) {
        console.error('인증 사진 조회 실패:', error);
        if (mounted) setSubmissionsError('인증 사진을 불러오지 못했습니다.');
      } finally {
        if (mounted) setLoadingSubmissions(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const filteredSubmissions = useMemo(() => {
    const days = PERIOD_DAYS[period];
    if (days == null) return submissions;
    const now = Date.now();
    const from = now - days * 86400000;
    const to = now - (days - 7) * 86400000;
    return submissions.filter((s) => {
      const t = new Date(s.submitted_at).getTime();
      return t >= from && t < to;
    });
  }, [submissions, period]);

  const selectedSubmissions = useMemo(
    () => submissions.filter((s) => selectedIds.includes(s.media_s3_key as string)),
    [submissions, selectedIds],
  );
  const mediaKeys = useMemo(
    () => selectedSubmissions.map((s) => s.media_s3_key as string),
    [selectedSubmissions],
  );

  // ⭐ 수정: 대본을 생성해둔 뒤 사진 선택을 바꾸면 그 대본은 이제 다른 사진 기준이라
  // 더 이상 유효하지 않다 - 선택이 바뀔 때마다 저장된 대본/제목/자동매칭 BGM을 초기화해서
  // "생성하기"/"자동생성"이 무조건 새로 생성하게 만든다. (아직 대본을 만든 적 없으면
  // captions가 이미 null이라 조용히 스킵됨)
  const mediaKeysKey = mediaKeys.join(',');
  const prevMediaKeysKey = React.useRef(mediaKeysKey);
  useEffect(() => {
    if (prevMediaKeysKey.current === mediaKeysKey) return;
    prevMediaKeysKey.current = mediaKeysKey;
    if (captions != null) {
      setCaptions(null);
      setScriptTitle(null);
      setAutoBgmId(null);
      toast.show('사진 선택이 바뀌어 이전에 생성한 대본을 초기화했습니다.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaKeysKey]);

  const toggle = (mediaS3Key: string) =>
    setSelectedIds((cur) => {
      if (cur.includes(mediaS3Key)) return cur.filter((x) => x !== mediaS3Key);
      if (cur.length >= MAX_MEDIA_SELECTION) {
        toast.show(`사진은 최대 ${MAX_MEDIA_SELECTION}장까지 선택할 수 있어요.`);
        return cur;
      }
      return [...cur, mediaS3Key];
    });

  // 백엔드는 quest_title을 문자열 하나로만 받아서, 서로 다른 퀘스트 사진을 섞어
  // 선택하면 전부 나열하지 않고 "A, B" / 3개 이상이면 "A 외 N건"으로 요약한다.
  const resolveQuestTitle = async (): Promise<string> => {
    if (selectedSubmissions.length === 0) return DEFAULT_TITLE;

    const uniqueQuestIds: number[] = [];
    for (const s of selectedSubmissions) {
      if (!uniqueQuestIds.includes(s.quest_id)) uniqueQuestIds.push(s.quest_id);
    }

    const titles = await Promise.all(
      uniqueQuestIds.map(async (questId) => {
        const cached = questTitleCache.current.get(questId);
        if (cached) return cached;
        try {
          const quest = await getQuest(questId);
          questTitleCache.current.set(questId, quest.quest_title);
          return quest.quest_title;
        } catch (error) {
          console.error('퀘스트 제목 조회 실패:', error);
          return null;
        }
      }),
    );
    const resolved = titles.filter((t): t is string => !!t);

    if (resolved.length === 0) return DEFAULT_TITLE;
    const combined =
      resolved.length <= 2 ? resolved.join(', ') : `${resolved[0]} 외 ${resolved.length - 1}건`;
    // ShortFormCreateRequest.title / ScriptGenerateRequest.quest_title 둘 다 max_length=255
    return combined.slice(0, 255);
  };

  /** 대본/음악 팝업 중 먼저 필요해지는 시점에 한 번만 호출해 shorts_id를 확보한다. */
  const ensureShortsId = async (): Promise<number> => {
    if (shortsId != null) return shortsId;
    const title = await resolveQuestTitle();
    const created = await createShortform(title, mediaKeys, selectedBgm?.bgm_id);
    setShortsId(created.shorts_id);
    setShortsIdBgmId(selectedBgm?.bgm_id);
    setShortsIdTitle(title);
    return created.shorts_id;
  };

  const openScriptPopup = async () => {
    if (selectedSubmissions.length === 0) {
      toast.show('사진을 먼저 선택해주세요.');
      return;
    }
    try {
      setPreparing(true);
      await ensureShortsId();
      setScriptOpen(true);
    } catch (error) {
      console.error('숏폼 준비 실패:', error);
      toast.show('숏폼 생성을 시작하지 못했습니다.');
    } finally {
      setPreparing(false);
    }
  };

  const handleGenerate = async () => {
    if (selectedSubmissions.length === 0) {
      toast.show('사진을 먼저 선택해주세요.');
      return;
    }
    try {
      setGenerating(true);
      const finalBgmId = selectedBgm?.bgm_id;
      const finalTitle = scriptTitle ?? (await resolveQuestTitle());

      let finalShortsId = shortsId;
      // shortsId가 없거나(대본 팝업을 아예 안 연 경우), 대본을 먼저 만든 뒤 음악을
      // 나중에 골라서(또는 그 반대) 이미 생성된 레코드의 title/bgm_id와 어긋난 경우
      // → 최종 값으로 다시 생성해서 두 선택이 모두 반영되게 한다.
      if (finalShortsId == null || shortsIdBgmId !== finalBgmId || shortsIdTitle !== finalTitle) {
        const created = await createShortform(finalTitle, mediaKeys, finalBgmId);
        finalShortsId = created.shorts_id;
        setShortsId(finalShortsId);
        setShortsIdBgmId(finalBgmId);
        setShortsIdTitle(finalTitle);
      }

      navigation.navigate('Generating', {
        shortsId: finalShortsId,
        mediaKeys,
        captions,
        title: finalTitle,
        bgmId: finalBgmId,
      });
    } catch (error) {
      console.error('숏폼 생성을 시작하지 못했습니다:', error);
      toast.show('숏폼 생성을 시작하지 못했습니다.');
    } finally {
      setGenerating(false);
    }
  };

  /**
   * "자동생성" 버튼(사진 선택 화면 하단) - AI가 선택된 사진을 분석해 대본과
   * 분위기에 맞는 음악(BGM)을 전부 자동으로 정한 뒤 영상까지 만든다. BGM은 항상 AI
   * 서버의 RAG 매칭 결과를 쓴다 - 자동 경로는 사용자가 수동으로 골라둔 음악(selectedBgm)을
   * 무시한다.
   *
   * ⭐ 수정: 예전엔 대본 생성(생성기 호출 중 가장 오래 걸리는 단계)을 이 화면에 머문 채로
   * 끝낸 뒤에야 Generating으로 넘어가서, 그동안 화면이 멈춘 것처럼 보였다(버튼 안의 작은
   * 스피너 말고는 아무 진행 표시가 없었음). 이제 대본/음악을 실제로 만드는 무거운 작업을
   * 전부 GeneratingScreen으로 넘기고, 여기서는 퀘스트 제목만 미리 계산해서 바로
   * navigate한다 - 화면 전환이 즉시 일어나고, 그 뒤 모든 단계(대본 생성 → 음악 매칭 →
   * 렌더링)의 진행 상황을 GeneratingScreen이 계속 보여준다.
   */
  const handleAutoGenerate = async () => {
    if (selectedSubmissions.length === 0) {
      toast.show('사진을 먼저 선택해주세요.');
      return;
    }
    try {
      setAutoGenerating(true);
      // AI 대본 팝업의 "적용하기"로 이미 대본을 저장해둔 상태라면 그대로 넘겨서
      // GeneratingScreen이 generateScript를 다시 호출하지 않게 한다(같은 사진을 두 번
      // 분석하는 낭비 방지 - Gemini 호출 할당량도 아낀다).
      const questTitle = scriptTitle ?? (await resolveQuestTitle());
      navigation.navigate('Generating', {
        auto: true,
        shortsId,
        mediaKeys,
        captions,
        questTitle,
        matchedBgmId: autoBgmId,
      });
    } catch (error) {
      console.error('자동 생성을 시작하지 못했습니다:', error);
      toast.show('자동 생성을 시작하지 못했습니다.');
    } finally {
      setAutoGenerating(false);
    }
  };

  const GAP = 4;
  const GRID_PAD = 16;
  const cell = Math.floor((width - GRID_PAD * 2 - GAP * 2) / 3);

  const footerH = 46 + 10 + 52 + 20; // buttons row + gap + primary + top pad

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <HazeBackground />
      <MainHeader />

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: footerH + insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.h1}>숏폼 생성</Text>
        <Text style={styles.sub}>퀘스트 인증 사진으로 숏폼 영상을 만들어보세요.</Text>

        {/* 기간 필터 칩 */}
        <View style={styles.chipsRow}>
          {PERIODS.map((label, i) => {
            const active = i === period;
            return (
              <SpringButton
                key={label}
                onPress={() => setPeriod(i)}
                pressScale={0.92}
                style={[styles.chip, active ? styles.chipActive : styles.chipIdle]}
              >
                <Text style={[styles.chipText, active ? styles.chipTextActive : styles.chipTextIdle]}>
                  {label}
                </Text>
              </SpringButton>
            );
          })}
        </View>

        {/* 3열 사진 그리드 - 승인된 퀘스트 인증 사진 중 선택 */}
        {loadingSubmissions ? (
          <View style={styles.stateWrap}>
            <ActivityIndicator color={colors.primaryDark} />
            <Text style={styles.stateText}>인증 사진을 불러오는 중입니다</Text>
          </View>
        ) : submissionsError ? (
          <View style={styles.stateWrap}>
            <Text style={styles.errorText}>{submissionsError}</Text>
          </View>
        ) : filteredSubmissions.length === 0 ? (
          <View style={styles.stateWrap}>
            <Text style={styles.stateText}>선택한 기간에 인증 사진이 없습니다</Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {filteredSubmissions.map((item, i) => {
              const key = item.media_s3_key as string;
              const sel = selectedIds.includes(key);
              return (
                <Animated.View
                  key={key}
                  // ⭐ 수정: 인덱스 기반 지연을 완전히 제거 - 계단식으로 순차 등장하는
                  // 연출 자체가 "로딩이 오래 걸린다"는 인상을 줘서, 데이터가 도착하는
                  // 즉시 전부 한꺼번에 나타나게 한다.
                  entering={ZoomIn.duration(360)}
                  style={{ width: cell, height: cell }}
                >
                  <Pressable
                    onPress={() => toggle(key)}
                    style={[styles.cell, sel && styles.cellSelected]}
                  >
                    <Image
                      source={{ uri: item.media_url as string }}
                      style={StyleSheet.absoluteFill}
                      resizeMode="cover"
                    />
                    {/* ⭐ 추가: 동영상 인증 자료에서 뽑은 대표 프레임은 사진과 구분이
                        안 돼서 헷갈렸다 - 배지로 "동영상"임을 표시한다. */}
                    {item.is_video ? (
                      <View style={styles.videoBadge}>
                        <PlayTri size={9} color="#fff" />
                        <Text style={styles.videoBadgeText}>동영상</Text>
                      </View>
                    ) : null}
                    {sel ? (
                      <View style={styles.badge}>
                        <CheckMark size={12} color="#fff" />
                      </View>
                    ) : null}
                  </Pressable>
                </Animated.View>
              );
            })}
          </View>
        )}

        <Text style={styles.count}>{selectedIds.length}장 선택됨</Text>
      </ScrollView>

      {/* 하단 액션 (사진첩 fade → 배경으로 자연스럽게) */}
      <LinearGradient
        colors={['rgba(238,246,240,0)', colors.screenBg]}
        locations={[0, 0.3]}
        style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}
      >
        <View style={styles.footerRow}>
          <View style={styles.footerHalf}>
            <SpringButton onPress={openScriptPopup} disabled={preparing} style={styles.ghostBtn}>
              {preparing ? (
                <ActivityIndicator color={colors.primaryDark} size="small" />
              ) : (
                // ⭐ 수정: "AI 대본" → "AI 자막"
                <Text style={styles.ghostText}>AI 자막</Text>
              )}
            </SpringButton>
          </View>
          <View style={styles.footerHalf}>
            <SpringButton onPress={() => setMusicOpen(true)} style={styles.ghostBtn}>
              <Text style={styles.ghostText}>음악{selectedBgm ? ` · ${selectedBgm.title}` : ''}</Text>
            </SpringButton>
          </View>
        </View>
        <View style={[styles.footerRow, { marginBottom: 0 }]}>
          <View style={styles.footerHalf}>
            <SpringButton onPress={handleGenerate} disabled={generating} style={styles.primaryBtn}>
              {generating ? (
            <ActivityIndicator color={colors.primaryDark} />
          ) : (
            <Text style={styles.primaryText}>생성하기</Text>
              )}
        </SpringButton>
          </View>
          <View style={styles.footerHalf}>
            <SpringButton onPress={handleAutoGenerate} disabled={autoGenerating} style={styles.autoBtn}>
              {autoGenerating ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.autoText}>자동생성</Text>
              )}
            </SpringButton>
          </View>
        </View>
      </LinearGradient>

      <AiScriptPopup
        visible={scriptOpen}
        onClose={() => setScriptOpen(false)}
        shortsId={shortsId}
        mediaKeys={mediaKeys}
        questTitleResolver={resolveQuestTitle}
        savedCaptions={captions}
        savedTitle={scriptTitle}
        onConfirmed={(result) => {
          setCaptions(result.captions);
          setScriptTitle(result.title);
          // ⭐ 수정: "적용하기"로 저장된 대본과 함께 AI가 매칭한 BGM도 같이 기억해뒀다가
          // 바로 뒤에 "자동생성"을 누르면 재사용한다 (없으면 null - 이후 자동생성이
          // 자체적으로 새로 매칭한다).
          setAutoBgmId(result.bgm_id ?? null);
        }}
      />
      <MusicSheet
        visible={musicOpen}
        onClose={() => setMusicOpen(false)}
        selectedBgmId={selectedBgm?.bgm_id ?? null}
        onSelect={setSelectedBgm}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  body: { paddingHorizontal: 16, paddingTop: 16 },
  h1: { fontFamily: fonts.pixel, fontSize: 18, color: colors.primaryDark },
  sub: { fontSize: 13, color: '#888', marginTop: 2, marginBottom: 14, fontFamily: fonts.bodyR },
  stateWrap: { paddingVertical: 40, alignItems: 'center', justifyContent: 'center', gap: 10 },
  stateText: { fontSize: 13, color: colors.textMuted, fontFamily: fonts.bodyR },
  errorText: { fontSize: 13, color: colors.danger, fontFamily: fonts.bodyR },

  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  chipActive: { backgroundColor: colors.primaryDark, borderWidth: 2, borderColor: colors.primaryDark },
  chipIdle: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.pixelBorder },
  chipText: { fontSize: 13, fontWeight: '700', fontFamily: fonts.bodyB },
  chipTextActive: { color: colors.parchment },
  chipTextIdle: { color: colors.primaryDark },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 12 },
  cell: { flex: 1, borderRadius: 8, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  cellSelected: { borderColor: colors.gold },
  badge: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoBadge: {
    position: 'absolute',
    left: 5,
    bottom: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  videoBadgeText: { fontSize: 9, fontWeight: '700', color: '#fff', fontFamily: fonts.bodyB },
  count: { textAlign: 'right', fontFamily: fonts.pixel, fontSize: 14, color: colors.gold },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10 },
  footerRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  footerHalf: { flex: 1 },
  ghostBtn: {
    height: 46,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.pixelBorder,
    backgroundColor: colors.screenBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostText: { fontFamily: fonts.pixel, fontSize: 15, color: colors.primaryDark },
  primaryBtn: {
    height: 52,
    borderRadius: 8,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 5,
  },
  primaryText: { fontFamily: fonts.pixel, fontSize: 18, color: colors.primaryDark },
  autoBtn: {
    height: 52,
    borderRadius: 8,
    backgroundColor: colors.xpGreen,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.xpGreen,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 5,
  },
  autoText: { fontFamily: fonts.pixel, fontSize: 18, color: colors.white },
});
