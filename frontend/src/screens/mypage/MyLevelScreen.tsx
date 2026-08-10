import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from '@react-navigation/native';
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { colors, fonts, radii, CATEGORY_DEFS, CATEGORY_ICONS } from '../../theme';
import HazeBackground from '../../components/HazeBackground';
import MainHeader from '../../components/MainHeader';
import SpringButton from '../../components/SpringButton';
import PixelProgress from '../../components/PixelProgress';
import GamePopup, { PopupButtons } from '../../components/GamePopup';
import GdqInput from '../../components/GdqInput';
import { useToast } from '../../components/Toast';
import {
  ConicAvatar,
  useCountUp,
  comma,
  CHART_LAYOUT,
  chartX,
  chartY,
  chartLine,
  pathLength,
} from './_parts';
import { getGrowthStatus, DailyXp } from '../../api/growth';
import { uploadProfileImage, updateMyProfile } from '../../api/mypage';
import { useProfile } from '../../context/ProfileContext';
import { getFullImageUrl } from '../shop/_parts';

function categoryLabel(key: string): string {
  return CATEGORY_DEFS.find((c) => c.key === key)?.label ?? key;
}

const AnimatedPath = Animated.createAnimatedComponent(Path);

const WEEKDAY_KR = ['일', '월', '화', '수', '목', '금', '토'];

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? '' : WEEKDAY_KR[d.getDay()];
}

const WeeklyChart = React.memo(function WeeklyChart({ graph }: { graph: DailyXp[] }) {
  const rawValues = graph.map((d) => d.cumulative_xp);
  const knownValues = rawValues.filter((v): v is number => v !== null);
  const maxV = Math.max(...knownValues, 10);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxV * f));

  const len = pathLength(rawValues, maxV);
  const draw = useSharedValue(0);
  const fade = useSharedValue(0);

  useEffect(() => {
    draw.value = withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.cubic) });
    fade.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) });
  }, []);

  const drawProps = useAnimatedProps(() => ({ strokeDashoffset: len * (1 - draw.value) }));
  const fadeProps = useAnimatedProps(() => ({ opacity: fade.value }));

  return (
    <View style={{ width: '100%', aspectRatio: CHART_LAYOUT.W / CHART_LAYOUT.H }}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${CHART_LAYOUT.W} ${CHART_LAYOUT.H}`}>
        {grid.map((g, i) => (
          <Line
            key={i}
            x1={CHART_LAYOUT.pad}
            y1={chartY(g, maxV)}
            x2={CHART_LAYOUT.W - CHART_LAYOUT.pad}
            y2={chartY(g, maxV)}
            stroke="#EEF1F0"
            strokeWidth={1}
          />
        ))}
        <AnimatedPath
          animatedProps={drawProps}
          d={chartLine(rawValues, maxV)}
          fill="none"
          stroke={colors.xpGreen}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={len}
        />
        {graph.map((d, i) =>
          d.cumulative_xp === null ? null : (
            <AnimatedPath
              key={i}
              animatedProps={fadeProps}
              d={`M ${chartX(i, graph.length)} ${chartY(d.cumulative_xp, maxV)} m -3 0 a 3 3 0 1 0 6 0 a 3 3 0 1 0 -6 0`}
              fill={colors.xpGreen}
            />
          )
        )}
        {graph.map((d, i) => (
          <SvgText key={i} x={chartX(i, graph.length)} y={CHART_LAYOUT.H - 4} fontSize={10} fill="#888" textAnchor="middle">
            {dayLabel(d.date)}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
});

export default function MyLevelScreen({ navigation }: any) {
  const { profile, loading: profileLoading, error: profileError, refreshProfile, setProfile } = useProfile();
  const [level, setLevel] = useState(1);
  const [currentXp, setCurrentXp] = useState(0);
  const [nextLevelXp, setNextLevelXp] = useState(1000);
  const [levelFloorXp, setLevelFloorXp] = useState(0);
  const [graph, setGraph] = useState<DailyXp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const toast = useToast();

  const [editVisible, setEditVisible] = useState(false);
  const [editNickname, setEditNickname] = useState('');
  const [editNickError, setEditNickError] = useState<string | null>(null);
  const [editCats, setEditCats] = useState<Record<string, boolean>>({});
  const [savingProfile, setSavingProfile] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refreshProfile();
    }, [refreshProfile])
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      setError(null);
      getGrowthStatus()
        .then((growth) => {
          if (cancelled) return;
          setLevel(growth.current_level);
          setCurrentXp(growth.current_xp);
          setNextLevelXp(growth.next_level_xp);
          setLevelFloorXp(growth.current_level_floor_xp);
          setGraph(growth.weekly_xp_graph);
        })
        .catch((err) => {
          if (!cancelled) setError(err.message ?? '정보를 불러오지 못했습니다.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const pickAndUploadAvatar = async () => {
    if (uploadingImage) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      toast.show('사진 접근 권한을 허용해 주세요.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (result.canceled || result.assets.length === 0) return;

    try {
      setUploadingImage(true);
      const updated = await uploadProfileImage(result.assets[0].uri);
      setProfile(updated);
      toast.show('프로필 이미지를 변경했어요.');
    } catch (err) {
      toast.show('프로필 이미지 변경에 실패했어요.');
    } finally {
      setUploadingImage(false);
    }
  };

  const openEditProfile = () => {
    if (!profile) return;
    setEditNickname(profile.nickname);
    setEditNickError(null);
    const cats: Record<string, boolean> = {};
    CATEGORY_DEFS.forEach((c) => {
      cats[c.key] = !!profile.category?.includes(c.key);
    });
    setEditCats(cats);
    setEditVisible(true);
  };

  const toggleEditCat = (key: string) => setEditCats((s) => ({ ...s, [key]: !s[key] }));

  const saveProfile = async () => {
    const nick = editNickname.trim();
    if (nick.length < 2 || nick.length > 10) {
      setEditNickError('닉네임은 2~10자로 입력해 주세요.');
      return;
    }
    setEditNickError(null);
    const category = Object.keys(editCats).filter((k) => editCats[k]);

    try {
      setSavingProfile(true);
      const updated = await updateMyProfile({ nickname: nick, category });
      setProfile(updated);
      setEditVisible(false);
      toast.show('프로필을 수정했어요.');
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      toast.show(typeof detail === 'string' ? detail : '프로필 수정에 실패했어요.');
    } finally {
      setSavingProfile(false);
    }
  };

  const xpCount = useCountUp(currentXp);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <HazeBackground />
      <MainHeader showBack title="레벨" />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.profileCard}>
          <Pressable onPress={pickAndUploadAvatar} disabled={uploadingImage}>
            <ConicAvatar
              size={64}
              deco
              imageUri={profile?.profile_image_url ?? null}
              borderImageUrl={profile?.equipped_border_image_url ? getFullImageUrl(profile.equipped_border_image_url) : null}
            />
            {uploadingImage && (
              <View style={styles.avatarUploadOverlay}>
                <ActivityIndicator color={colors.parchment} size="small" />
              </View>
            )}
          </Pressable>
          <View style={styles.profileInfo}>
            {profileLoading ? (
              <ActivityIndicator color={colors.primaryDark} style={styles.profileInfoLoading} />
            ) : profileError || !profile ? (
              <Text style={styles.name}>프로필을 불러오지 못했어요</Text>
            ) : (
              <>
                <View style={styles.nameRow}>
                  <Text style={styles.name}>{profile.nickname}</Text>
                  <Pressable onPress={openEditProfile} hitSlop={8} style={styles.editBtn}>
                    <Text style={styles.editIcon}>✏️</Text>
                  </Pressable>
                </View>
                <View style={styles.titleRow}>
                  <Text style={styles.title}>{profile.title}</Text>
                  {profile.category && profile.category.length > 0 && (
                    <Text style={styles.categoryText} numberOfLines={1} ellipsizeMode="tail">
                      {profile.category.map(categoryLabel).join(', ')}
                    </Text>
                  )}
                </View>
                <View style={styles.metaRow}>
                  <Text style={styles.lv}>LV.{level}</Text>
                  <Text style={styles.streak}>🔥 {profile.daily_streak}일째 연속접속</Text>
                </View>
              </>
            )}
          </View>
        </View>

        {loading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator color={colors.primaryDark} />
          </View>
        ) : error ? (
          <View style={styles.centerBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : (
          <>
            <View style={styles.xpBlock}>
              <View style={styles.xpHead}>
                <Text style={styles.xpLv}>LV.{level}</Text>
                <Text style={styles.xpVal}>
                  {comma(xpCount)} / {comma(nextLevelXp)} XP
                </Text>
              </View>
              <View style={styles.xpBarBox}>
                <PixelProgress
                  progress={
                    nextLevelXp - levelFloorXp > 0
                      ? (currentXp - levelFloorXp) / (nextLevelXp - levelFloorXp)
                      : 0
                  }
                  height={22}
                  color={colors.xpGreen}
                  track={colors.screenBg}
                />
              </View>
            </View>

            <Text style={styles.chartTitle}>주간 경험치 추이</Text>
            <View style={styles.chartCard}>
              {graph.length === 0 ? (
                <Text style={styles.emptyText}>최근 7일간 획득한 경험치가 없어요.</Text>
              ) : (
                <>
                  <WeeklyChart graph={graph} />
                  <View style={styles.legend}>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDash, { backgroundColor: colors.xpGreen }]} />
                      <Text style={styles.legendText}>이번 주 누적 XP</Text>
                    </View>
                  </View>
                </>
              )}
            </View>
          </>
        )}

        <SpringButton style={styles.rankBtn} onPress={() => navigation.navigate('Ranking')}>
          <Text style={styles.rankBtnText}>랭킹 보러가기</Text>
        </SpringButton>
      </ScrollView>

      <GamePopup visible={editVisible} onClose={() => setEditVisible(false)} title="프로필 수정" width={320}>
        <View style={{ alignSelf: 'stretch' }}>
          <Text style={styles.editLabel}>닉네임</Text>
          <GdqInput
            value={editNickname}
            onChangeText={(v) => {
              setEditNickname(v);
              if (editNickError) setEditNickError(null);
            }}
            placeholder="닉네임을 입력하세요"
            maxLength={10}
          />
          {editNickError ? <Text style={styles.editErrorText}>{editNickError}</Text> : null}

          <Text style={[styles.editLabel, { marginTop: 16 }]}>관심 카테고리</Text>
          <View style={styles.editGrid}>
            {CATEGORY_DEFS.map((c) => {
              const on = !!editCats[c.key];
              return (
                <Pressable
                  key={c.key}
                  onPress={() => toggleEditCat(c.key)}
                  style={[styles.editCatCell, on ? styles.editCatCellOn : styles.editCatCellOff]}
                >
                  <Image source={CATEGORY_ICONS[c.key]} style={styles.editCatIcon} />
                  <Text style={[styles.editCatLabel, { color: on ? colors.white : colors.parchment }]}>{c.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {savingProfile ? (
          <ActivityIndicator color={colors.gold} style={{ marginTop: 20 }} />
        ) : (
          <PopupButtons
            primaryLabel="저장"
            onPrimary={saveProfile}
            secondaryLabel="취소"
            onSecondary={() => setEditVisible(false)}
          />
        )}
      </GamePopup>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  scroll: { flex: 1 },
  body: { padding: 16, paddingBottom: 28 },

  profileCard: {
    backgroundColor: colors.parchment,
    borderWidth: 2,
    borderColor: colors.pixelBorder,
    borderRadius: radii.card,
    paddingTop: 18,
    paddingBottom: 16,
    paddingHorizontal: 16,
    marginBottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    shadowColor: '#5C3D1E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 3,
  },
  profileInfo: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  editBtn: { padding: 2 },
  editIcon: { fontSize: 13 },
  editLabel: { fontSize: 13, fontWeight: '700', color: colors.gold, marginBottom: 8, fontFamily: fonts.bodyB },
  editErrorText: { marginTop: 6, fontSize: 12, color: '#FF8A80', fontFamily: fonts.bodyM },
  editGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  editCatCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 42,
    borderRadius: radii.chip,
    paddingHorizontal: 10,
    width: '47%',
  },
  editCatCellOn: { backgroundColor: colors.primaryDark, borderWidth: 2, borderColor: colors.gold },
  editCatCellOff: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(242,215,131,0.35)' },
  editCatIcon: { width: 24, height: 24, borderRadius: 6 },
  editCatLabel: { fontSize: 13, fontWeight: '600', fontFamily: fonts.bodyM },
  profileInfoLoading: { alignSelf: 'flex-start' },
  avatarUploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    backgroundColor: 'rgba(3,50,54,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontSize: 18, fontWeight: '600', color: colors.primaryDark, fontFamily: fonts.bodyM },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1, marginBottom: 3 },
  title: { fontSize: 13, color: colors.gold, fontWeight: '600', fontFamily: fonts.bodyM },
  categoryText: { flexShrink: 1, fontSize: 11, color: colors.textMuted, fontFamily: fonts.bodyM },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lv: { fontFamily: fonts.pixel, fontSize: 15, color: colors.primaryDark },
  streak: { fontSize: 12, color: colors.xpGreen, fontWeight: '600', fontFamily: fonts.bodyM },

  centerBox: { paddingVertical: 32, alignItems: 'center' },
  errorText: { fontSize: 13, color: colors.textSecondary, fontFamily: fonts.bodyR },
  emptyText: { fontSize: 13, color: colors.textSecondary, fontFamily: fonts.bodyR, textAlign: 'center', paddingVertical: 24 },

  xpBlock: { marginBottom: 22 },
  xpHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 },
  xpLv: { fontFamily: fonts.pixel, fontSize: 18, color: colors.primaryDark },
  xpVal: { fontSize: 13, color: '#888', fontFamily: fonts.bodyR },
  xpBarBox: {
    borderWidth: 1.5,
    borderColor: colors.pixelBorder,
    borderRadius: 10,
    overflow: 'hidden',
  },

  chartTitle: { fontFamily: fonts.pixel, fontSize: 14, color: colors.primaryDark, marginBottom: 10 },
  chartCard: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 18,
    shadowColor: '#033236',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  legend: { flexDirection: 'row', gap: 16, justifyContent: 'center', marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDash: { width: 14, height: 3, borderRadius: 2 },
  legendText: { fontSize: 11, color: '#666', fontFamily: fonts.bodyR },

  rankBtn: {
    height: 50,
    borderRadius: 8,
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankBtnText: { color: colors.parchment, fontFamily: fonts.pixel, fontSize: 16 },
});