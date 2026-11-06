/**
 * SCREEN 1 · 메인 홈 (route QuestHome) — 홈 탭 ROOT.
 * MainHeader (no back). 진행중 퀘스트 드래그 캐러셀(빈 상태 토글) · 오늘의 추천 리스트
 * (스태거 페이드업) · 다시 추천 받기 · 퀘스트 등록 / 커스텀 추천 액션.
 */
import React, { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import type { ScrollViewInstance } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { colors, fonts, radii, CATEGORY_ICONS } from '../../theme';
import HazeBackground from '../../components/HazeBackground';
import MainHeader from '../../components/MainHeader';
import SpringButton from '../../components/SpringButton';
import { Coin, Star, DiffChip, ChevRight, ChevLeft, EmptyScroll, FloatSpark, Bob } from './_parts';
import { getQuests, getTodayRecommendation, refreshRecommendation, difficultyLabel, type Quest } from '../../api/quest';
import { getCurrentCoords } from '../../utils/location';

const iconFor = (code: string) => CATEGORY_ICONS[code] ?? CATEGORY_ICONS.other;

export default function HomeScreen({ navigation }: any) {
  const { width } = useWindowDimensions();
  
  // 진행중 캐러셀 전용. 전체 퀘스트 목록에서 IN_PROGRESS만 걸러 쓴다.
  const [quests, setQuests] = useState<Quest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // 오늘의 추천 전용. 조회는 0.1초, 생성은 수십 초라 로딩과 생성 중을 따로 둔다.
  const [recommended, setRecommended] = useState<Quest[]>([]);
  const [recLoading, setRecLoading] = useState(true);
  const [recError, setRecError] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [idx, setIdx] = useState(0);
  const scrollRef = useRef<ScrollViewInstance>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setQuests(await getQuests());
    } catch (err: any) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  // 홈 진입용. 오늘 것이 있으면 읽기만 하고, 없을 때만 새로 만든다.
  const loadRecommendation = async () => {
    setRecLoading(true);
    setRecError(false);
    try {
      const today = await getTodayRecommendation();
      if (today) {
        setRecommended(today);
        return;
      }
      // 오늘 추천이 없을 때만 위치 권한을 묻는다. 이미 있으면 팝업으로 멈춰 세울 이유가 없다.
      setGenerating(true);
      const coords = await getCurrentCoords();
      setRecommended(await refreshRecommendation(coords?.latitude, coords?.longitude));
    } catch (err: any) {
      setRecError(true);
    } finally {
      setGenerating(false);
      setRecLoading(false);
    }
  };

  // "다시 추천 받기" 전용. 오늘 것이 있어도 무조건 새로 만든다.
  const forceRefresh = async () => {
    // 수십 초짜리 작업이라 연타하면 파이프라인이 겹쳐 돌고 퀘스트가 중복 저장된다.
    if (generating) return;
    setGenerating(true);
    setRecError(false);
    try {
      const coords = await getCurrentCoords();
      setRecommended(await refreshRecommendation(coords?.latitude, coords?.longitude));
    } catch (err: any) {
      setRecError(true);
    } finally {
      setGenerating(false);
    }
  };

  // 상세 화면에서 퀘스트를 시작하고 돌아오면 캐러셀과 추천 목록이 함께 바뀌어야 한다.
  // useEffect는 화면이 처음 만들어질 때 한 번만 돌아서 복귀 시 갱신되지 않는다.
  // 진행중 목록은 돌아올 때마다 다시 받는다. 안 그러면 포기·완료한 퀘스트가 남는다. -양정운-
  useFocusEffect(
    useCallback(() => {
      // 진행중 목록은 빠르고 추천은 느릴 수 있다. 따로 돌려야 캐러셀이 먼저 뜬다.
      load();
      loadRecommendation();
    }, [])
  );

  const activeQuests = quests.filter((q) => q.quest_status === 'IN_PROGRESS');
  const empty = activeQuests.length === 0;

  const INNER = width - 32; // ScrollView horizontal padding 16 each side
  const CARD_W = INNER * 0.84;
  const STEP = CARD_W + 12;

  const openDetail = (q: Quest, active: boolean) => {
    navigation.navigate('QuestDetail', {
      questId: q.quest_id,
      questType: q.quest_type,
      title: q.quest_title,
      desc: q.quest_description,
      category: q.category_code,
      point: q.reward_point ?? 0,
      exp: q.reward_exp ?? 0,
      volunteerCenterId: q.volunteer_center_id,
      active,
    });
  };

  const onCarouselEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / STEP);
    setIdx(Math.max(0, Math.min(activeQuests.length - 1, i)));
  };
  const goTo = (i: number) => {
    const n = Math.max(0, Math.min(activeQuests.length - 1, i));
    setIdx(n);
    scrollRef.current?.scrollTo({ x: n * STEP, animated: true });
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <HazeBackground />
      <MainHeader />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* ── 진행중 퀘스트 header ── */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>진행중 퀘스트</Text>
          <View style={styles.headRight}>
            <Pressable onPress={() => goTo(idx - 1)} hitSlop={6}>
              <ChevLeft />
            </Pressable>
            <Pressable onPress={() => goTo(idx + 1)} hitSlop={6}>
              <ChevRight />
            </Pressable>
          </View>
        </View>

        {empty ? (
          <View style={styles.emptyBox}>
            <EmptyScroll />
            <Text style={styles.emptyText}>진행중인 퀘스트가 없어요</Text>
            {quests.length > 0 && (
              <Text style={styles.emptyHint}>아래 추천 퀘스트에서 골라보세요</Text>
            )}
          </View>
        ) : (
          <View style={styles.carouselWrap}>
            <ScrollView
              ref={scrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              decelerationRate="fast"
              snapToInterval={STEP}
              snapToAlignment="start"
              disableIntervalMomentum
              onMomentumScrollEnd={onCarouselEnd}
              contentContainerStyle={styles.carouselContent}
            >
              {activeQuests.map((q, i) => (
                <Pressable
                  key={q.quest_id}
                  onPress={() => openDetail(q, true)}
                  style={[styles.activeCard, { width: CARD_W, marginRight: i === activeQuests.length - 1 ? 0 : 12 }]}
                >
                  <LinearGradient
                    colors={['#0E4F40', '#033236']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0.5, y: 1 }}
                    style={StyleSheet.absoluteFill}
                  />
                  <FloatSpark left="14%" top="52%" delay={0} size={12} />
                  <FloatSpark left="82%" top="30%" delay={700} size={10} />
                  <FloatSpark left="46%" top="24%" delay={1300} glyph="✦" color="#7FD69A" size={9} />
                  <View style={styles.activeRow}>
                    <Bob amp={4} style={styles.activeIconTile}>
                      <Image source={iconFor(q.category_code)} style={styles.activeIcon} />
                    </Bob>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.activeTitle} numberOfLines={1}>{q.quest_title}</Text>
                      <View style={styles.rewardRow}>
                        <View style={styles.rewardItem}>
                          <Coin />
                          <Text style={styles.coinText}>{q.reward_point ?? 0} P</Text>
                        </View>
                        <View style={styles.rewardItem}>
                          <Star />
                          <Text style={styles.expText}>{q.reward_exp ?? 0} EXP</Text>
                        </View>
                      </View>
                    </View>
                    <View style={styles.progBadge}>
                      <Text style={styles.progBadgeText}>진행중</Text>
                    </View>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.dots}>
              {activeQuests.map((_, i) => (
                <View key={i} style={[styles.dot, i === idx ? styles.dotOn : styles.dotOff]} />
              ))}
            </View>
          </View>
        )}

        {/* ── 오늘의 추천 퀘스트 ── */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>오늘의 추천 퀘스트</Text>
        </View>
        <View style={styles.recList}>
          {generating ? (
            <View style={styles.listStateBox}>
              <ActivityIndicator color={colors.primaryDark} />
              <Text style={styles.listStateText}>AI가 오늘의 추천을 만들고 있어요</Text>
              <Text style={styles.listStateHint}>최대 1분 정도 걸릴 수 있어요</Text>
            </View>
          ) : recLoading ? (
            <View style={styles.listStateBox}>
              <ActivityIndicator color={colors.primaryDark} />
            </View>
          ) : recError ? (
            <View style={styles.listStateBox}>
              <Text style={styles.listStateText}>추천을 불러오지 못했어요</Text>
              <Pressable onPress={loadRecommendation} hitSlop={6}>
                <Text style={styles.emptyLink}>다시 시도</Text>
              </Pressable>
            </View>
          ) : recommended.length === 0 ? (
            <View style={styles.listStateBox}>
              <Text style={styles.listStateText}>추천된 퀘스트가 없어요</Text>
            </View>
          ) : (
            recommended.map((q, i) => (
              <Animated.View key={q.quest_id} entering={FadeInDown.delay(60 + i * 80).duration(460)}>
                <SpringButton onPress={() => openDetail(q, false)} pressScale={0.97} style={styles.recCard}>
                  <Image source={iconFor(q.category_code)} style={styles.recIcon} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.recTitle} numberOfLines={2}>{q.quest_title}</Text>
                    <View style={styles.recMeta}>
                      <DiffChip diff={difficultyLabel(q.difficulty)} />
                      <View style={styles.rewardItem}>
                        <Coin />
                        <Text style={styles.coinText}>{q.reward_point ?? 0}P</Text>
                      </View>
                      <View style={styles.rewardItem}>
                        <Star />
                        <Text style={styles.expText}>{q.reward_exp ?? 0} EXP</Text>
                      </View>
                    </View>
                  </View>
                  <ChevRight color="#B8A57F" />
                </SpringButton>
              </Animated.View>
            ))
          )}
        </View>

        <SpringButton onPress={forceRefresh} style={styles.retryBtn}>
          <Text style={[styles.retryText, generating && styles.retryTextDisabled]}>
            {generating ? '추천을 만드는 중...' : '다시 추천 받기'}
          </Text>
        </SpringButton>

        <View style={styles.actionRow}>
          <SpringButton onPress={() => navigation.navigate('QuestRegister')} style={[styles.actionBtn, styles.actionDark]}>
            <Text style={styles.actionDarkText}>퀘스트 등록</Text>
          </SpringButton>
          <SpringButton onPress={() => navigation.navigate('AiRecommend')} style={[styles.actionBtn, styles.actionGold]}>
            <Text style={styles.actionGoldText}>커스텀 추천</Text>
          </SpringButton>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  body: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 28 },

  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontFamily: fonts.pixel, fontSize: 16, color: colors.primaryDark },
  headRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toggleChip: { borderWidth: 1, borderColor: '#D6E7DC', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: colors.white },
  toggleText: { fontSize: 11, color: colors.textSecondary, fontFamily: fonts.bodyR },

  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 2,
    borderColor: '#C9D6CE',
    borderStyle: 'dashed',
    borderRadius: radii.card,
    paddingVertical: 26,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.5)',
    marginBottom: 26,
  },
  emptyText: { fontSize: 13, color: colors.textMuted, fontFamily: fonts.bodyR },
  emptyLink: { fontSize: 13, fontWeight: '700', color: colors.primaryDark, textDecorationLine: 'underline', fontFamily: fonts.bodyB },
  emptyHint: { fontSize: 13, color: colors.textMuted, fontFamily: fonts.bodyR },

  carouselWrap: { marginBottom: 24, marginHorizontal: -16 },
  carouselContent: { paddingHorizontal: 16, paddingVertical: 6 },
  activeCard: {
    borderRadius: radii.card,
    borderWidth: 2,
    borderColor: colors.gold,
    overflow: 'hidden',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  activeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, zIndex: 2 },
  activeIconTile: {
    width: 46,
    height: 46,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(212,160,23,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeIcon: { width: 34, height: 34 },
  activeTitle: { fontFamily: fonts.pixel, fontSize: 15, color: '#F5EFD8', marginBottom: 5 },
  // 진행중 배지 — QuestCard 배지 스타일 그대로
  progBadge: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#57C878',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  progBadgeText: { fontSize: 10, fontWeight: '800', color: '#A8ECBF', fontFamily: fonts.bodyB },

  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 10 },
  dot: { height: 7, borderRadius: 4 },
  dotOn: { width: 18, backgroundColor: colors.primaryDark },
  dotOff: { width: 7, backgroundColor: '#C9D6CE' },

  recList: { gap: 10, marginBottom: 16 },
  listStateBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 32, gap: 10 },
  listStateText: { fontSize: 13, color: colors.textMuted, fontFamily: fonts.bodyR },
  listStateHint: { fontSize: 11, color: colors.textMuted, fontFamily: fonts.bodyR, opacity: 0.7 },
  recCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.parchment,
    borderWidth: 2,
    borderColor: colors.pixelBorder,
    borderRadius: radii.button,
    padding: 11,
  },
  recIcon: { width: 44, height: 44, borderRadius: 10 },
  recTitle: { fontFamily: fonts.pixel, fontSize: 13, color: '#3A2A12', lineHeight: 17, marginBottom: 6 },
  recMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },

  rewardRow: { flexDirection: 'row', gap: 8 },
  rewardItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  coinText: { fontSize: 11, fontWeight: '700', color: '#F2D783', fontFamily: fonts.bodyB },
  expText: { fontSize: 11, fontWeight: '700', color: '#F2D783', fontFamily: fonts.bodyB },

  retryBtn: {
    height: 44,
    borderWidth: 1,
    borderColor: '#D6E7DC',
    borderRadius: radii.input,
    backgroundColor: colors.screenBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  retryText: { fontSize: 14, fontWeight: '700', color: colors.primaryDark, fontFamily: fonts.bodyB },
  retryTextDisabled: { color: colors.textMuted },

  actionRow: { flexDirection: 'row', gap: 10 },
  actionBtn: { flex: 1, height: 50, borderRadius: radii.button, alignItems: 'center', justifyContent: 'center' },
  actionDark: { backgroundColor: colors.primaryDark },
  actionDarkText: { color: colors.white, fontSize: 14, fontWeight: '700', fontFamily: fonts.bodyB },
  actionGold: { backgroundColor: colors.gold },
  actionGoldText: { color: '#3A2A12', fontSize: 14, fontWeight: '700', fontFamily: fonts.bodyB },
});
