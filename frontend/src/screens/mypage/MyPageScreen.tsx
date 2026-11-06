/**
 * SCREEN 06-1 · 마이페이지 (route MyPage) — 마이페이지 탭 ROOT (MainHeader, no back).
 * 골드 conic 링 프로필 카드(→ Level) · 퀘스트 달성 타임라인(내부 스크롤, 스태거) ·
 * 달성 상세 팝업(GamePopup) · 숏폼 만들기 / 아이템 목록 버튼.
 * Matches 06_mypage_flow.dc.html screen 1 + popup 2.
 */
// ⭐ 수정: useEffect, ActivityIndicator 추가
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker'; // ⭐ 수정
import { useFocusEffect } from '@react-navigation/native'; // ⭐ 수정: 아이템 목록에서 칭호 장착 후 돌아왔을 때 실시간 반영
import { StatusBar } from 'expo-status-bar';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { colors, fonts, radii, CATEGORY_DEFS, CATEGORY_ICONS, brand } from '../../theme'; // ⭐ 수정: CATEGORY_DEFS 추가
import HazeBackground from '../../components/HazeBackground';
import MainHeader from '../../components/MainHeader';
import SpringButton from '../../components/SpringButton';
import GamePopup, { PopupButtons } from '../../components/GamePopup'; // ⭐ 수정: PopupButtons 추가
import GdqInput from '../../components/GdqInput'; // ⭐ 수정
import { useToast } from '../../components/Toast';
import { ConicAvatar, ChevronRight } from './_parts'; // ⭐ 수정: 더미 ACHIEVEMENTS/Achievement 제거
import { PencilIcon } from '../../components/PixelIcons'; // ⭐ 수정: 닉네임 수정 아이콘 가독성 개선 (이모지 → SVG)
import {
  getMyQuestAchievements,
  type MyQuestAchievement,
  uploadProfileImage,
  updateMyProfile, // ⭐ 수정
} from '../../api/mypage'; // ⭐ 수정
import { useProfile } from '../../context/ProfileContext'; // ⭐ 수정: 프로필 헤더를 드로어와 공유
import { getFullImageUrl } from '../shop/_parts'; // ⭐ 수정: 장착 테두리 image_url이 상대경로(/static/...)라 base URL을 붙여야 함
import { checkNicknameAvailable } from '../../api/auth'; // ⭐ 수정: 회원가입에서 쓰던 닉네임 중복확인 함수 재사용

// ⭐ 수정: 회원가입(SignupContext)과 같은 색상으로 통일
const NICK_OK_GREEN = '#4CAF50';
const NICK_BAD_RED = '#E53935';

// ⭐ 수정: completed_at(ISO)을 리스트용 짧은 날짜 / 팝업용 상세 시각 문자열로 변환
function formatShortDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function formatCompletedAt(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}.${m}.${day} ${hh}:${mm}`;
}

// ⭐ 수정: 관심카테고리 key(예: 'volunteer') → 화면 표기 라벨(예: '봉사'). CATEGORY_DEFS에 없는
// 값(예: 옛 seed 데이터의 한글 저장값)은 그대로 원문을 보여준다.
function categoryLabel(key: string): string {
  return CATEGORY_DEFS.find((c) => c.key === key)?.label ?? key;
}

export default function MyPageScreen({ navigation }: any) {
  // ⭐ 수정: 더미 Achievement 대신 API 응답 타입 + 로딩/에러 상태
  const [selected, setSelected] = useState<MyQuestAchievement | null>(null);
  const [achievements, setAchievements] = useState<MyQuestAchievement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // ⭐ 수정: 프로필 헤더(이름/칭호/레벨/연속접속일/이미지)는 드로어와 공유하는 Context에서 가져온다
  const { profile, loading: profileLoading, error: profileError, refreshProfile, setProfile } = useProfile();
  const [uploadingImage, setUploadingImage] = useState(false);
  const toast = useToast();

  // ⭐ 수정: 프로필 수정(닉네임/관심카테고리) 모달 상태
  const [editVisible, setEditVisible] = useState(false);
  const [editNickname, setEditNickname] = useState('');
  const [editNickError, setEditNickError] = useState<string | null>(null);
  const [editCats, setEditCats] = useState<Record<string, boolean>>({});
  const [savingProfile, setSavingProfile] = useState(false);
  // ⭐ 수정: 닉네임 중복확인(회원가입과 동일한 checkNicknameAvailable 재사용) 상태
  const [editNickChecking, setEditNickChecking] = useState(false);
  const [editNickOk, setEditNickOk] = useState(false);
  const [editNickMsg, setEditNickMsg] = useState<{ text: string; color: string } | null>(null);

  // ⭐ 수정: 달성 퀘스트 타임라인 조회 — 재시도 버튼과 포커스 재조회 둘 다에서 재사용
  const loadAchievements = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setAchievements(await getMyQuestAchievements());
    } catch (err: any) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // ⭐ 수정: 마운트 + 포커스될 때마다 재조회 (예전엔 마운트 1회뿐이라, 한 번 실패(예: 백엔드
  // 마이그레이션 미적용)하면 화면이 언마운트되기 전까진 계속 실패 문구만 보였음)
  useFocusEffect(
    useCallback(() => {
      loadAchievements();
    }, [loadAchievements])
  );

  // ⭐ 수정: 프로필 헤더 조회 — 마운트 + 아이템 목록에서 칭호 장착/해제하고 돌아올 때마다
  // Context의 refreshProfile()을 호출해 재조회한다. Context 상태이므로 이 화면뿐 아니라
  // 드로어 상단도 같은 값으로 즉시 함께 갱신된다.
  useFocusEffect(
    useCallback(() => {
      refreshProfile();
    }, [refreshProfile])
  );

  // ⭐ 수정: 프로필 이미지 탭 → 갤러리 열기 → 업로드
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

  // ⭐ 수정: 연필 버튼 탭 → 현재 프로필 값으로 수정 모달 초기화 후 오픈
  const openEditProfile = () => {
    if (!profile) return;
    setEditNickname(profile.nickname);
    setEditNickError(null);
    setEditNickChecking(false);
    setEditNickOk(false);
    setEditNickMsg(null);
    const cats: Record<string, boolean> = {};
    CATEGORY_DEFS.forEach((c) => {
      cats[c.key] = !!profile.category?.includes(c.key);
    });
    setEditCats(cats);
    setEditVisible(true);
  };

  const toggleEditCat = (key: string) => setEditCats((s) => ({ ...s, [key]: !s[key] }));

  // ⭐ 수정: 닉네임 중복확인 버튼 - 회원가입 화면(ProfileScreen)과 동일하게
  // api/auth.ts의 checkNicknameAvailable을 그대로 재사용한다. 현재 내 닉네임과
  // 똑같이(안 바꾸고) 저장하려는 경우엔 서버에 물어볼 필요 없이 그대로 통과시킨다 -
  // 그 엔드포인트는 로그인 여부/현재 유저를 모르고 그냥 "이미 존재하는 닉네임인지"만
  // 보므로, 안 바꿨는데 물어보면 "내 것"인데도 중복이라고 나온다.
  const checkEditNickname = async (): Promise<boolean> => {
    const nick = editNickname.trim();
    if (nick.length < 2 || nick.length > 10) {
      setEditNickOk(false);
      setEditNickMsg({ text: '사용할 수 없는 닉네임입니다. (2~10자)', color: NICK_BAD_RED });
      return false;
    }
    if (nick === profile?.nickname) {
      setEditNickOk(true);
      setEditNickMsg({ text: '현재 사용 중인 닉네임입니다.', color: NICK_OK_GREEN });
      return true;
    }
    setEditNickChecking(true);
    try {
      const res = await checkNicknameAvailable(nick);
      setEditNickOk(res.available);
      setEditNickMsg({ text: res.message, color: res.available ? NICK_OK_GREEN : NICK_BAD_RED });
      return res.available;
    } catch {
      setEditNickOk(false);
      setEditNickMsg({ text: '중복확인에 실패했습니다. 잠시 후 다시 시도해 주세요.', color: NICK_BAD_RED });
      return false;
    } finally {
      setEditNickChecking(false);
    }
  };

  // ⭐ 수정: 닉네임(2~10자, 회원가입 화면과 동일한 규칙) + 관심카테고리 부분 수정 저장
  const saveProfile = async () => {
    const nick = editNickname.trim();
    if (nick.length < 2 || nick.length > 10) {
      setEditNickError('닉네임은 2~10자로 입력해 주세요.');
      return;
    }
    // 닉네임을 바꿨다면 저장 전에 중복확인을 통과해야 한다 - 버튼을 안 눌렀으면
    // 여기서 대신 한 번 확인한다(회원가입 AccountScreen의 이메일 검증과 동일한 패턴).
    if (nick !== profile?.nickname) {
      const ok = editNickOk || (await checkEditNickname());
      if (!ok) return;
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

  const goShortform = () => {
    try {
      navigation.navigate('Shortform');
    } catch {}
  };
  const goItemList = () => navigation.navigate('ItemList');

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <HazeBackground />
      <MainHeader />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        {/* profile card → Level (아바타 탭 = 프로필 이미지 변경, 카메라 배지는 ConicAvatar deco) */}
        {/* ⭐ 수정: 더미 이름/칭호/레벨/연속접속일 → 실제 프로필 조회 + 아바타 탭 시 갤러리 업로드 */}
        <SpringButton style={styles.profileCard} onPress={() => navigation.navigate('MyLevel')} pressScale={0.985}>
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
                  {/* ⭐ 수정: 프로필 수정(닉네임/관심카테고리) 모달 진입 버튼 */}
                  <Pressable onPress={openEditProfile} hitSlop={8} style={styles.editBtn}>
                    <PencilIcon size={14} color={colors.primaryDark} />
                  </Pressable>
                </View>
                {/* ⭐ 수정: 칭호 오른쪽에 관심카테고리 표시 */}
                <View style={styles.titleRow}>
                  <Text style={styles.title}>{profile.title}</Text>
                  {profile.category && profile.category.length > 0 && (
                    <Text style={styles.categoryText} numberOfLines={1} ellipsizeMode="tail">
                      {profile.category.map(categoryLabel).join(', ')}
                    </Text>
                  )}
                </View>
                <View style={styles.metaRow}>
                  <Text style={styles.lv}>LV.{profile.current_level}</Text>
                  <Text style={styles.streak}>🔥 {profile.daily_streak}일째 연속접속</Text>
                </View>
              </>
            )}
          </View>
          <ChevronRight />
        </SpringButton>

        {/* section title */}
        <Text style={styles.sectionTitle}>퀘스트 달성업적 및 타임라인</Text>

        {/* achievement timeline (inner scroll, max 320) */}
        {/* ⭐ 수정: 더미 ACHIEVEMENTS → API 응답(achievements) + 로딩/에러/빈 목록 상태 */}
        <View style={styles.timelineCard}>
          {loading ? (
            <View style={styles.timelineStateBox}>
              <ActivityIndicator color={colors.primaryDark} />
            </View>
          ) : loadError ? (
            <View style={styles.timelineStateBox}>
              <Text style={styles.timelineStateText}>달성 내역을 불러오지 못했어요</Text>
              {/* ⭐ 수정: 재시도 버튼 — 포커스 재조회를 놓쳤거나 일시적 오류일 때 수동으로 다시 시도 */}
              <SpringButton style={styles.retryBtn} onPress={loadAchievements}>
                <Text style={styles.retryBtnText}>다시 시도</Text>
              </SpringButton>
            </View>
          ) : achievements.length === 0 ? (
            <View style={styles.timelineStateBox}>
              <Text style={styles.timelineStateText}>달성한 퀘스트가 없습니다</Text>
            </View>
          ) : (
            <ScrollView
              style={{ maxHeight: 320 }}
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
            >
              {/* ⭐ 수정: key를 quest_id → submission_id로 변경 (같은 퀘스트를 여러 번 완료할 수 있어 quest_id는 중복 가능) */}
              {achievements.map((a, i) => (
                <Animated.View key={a.submission_id} entering={FadeInDown.delay(50 + i * 70).duration(450)}>
                  <SpringButton
                    style={[styles.achRow, i === achievements.length - 1 && styles.achRowLast]}
                    onPress={() => setSelected(a)}
                    pressScale={0.99}
                  >
                    <Image source={CATEGORY_ICONS[a.category_code] ?? CATEGORY_ICONS.other} style={styles.achIcon} />
                    <Text style={styles.achName}>{a.title}</Text>
                    <Text style={styles.achDate}>{formatShortDate(a.completed_at)}</Text>
                  </SpringButton>
                </Animated.View>
              ))}
            </ScrollView>
          )}
        </View>

        {/* actions */}
        <View style={styles.actions}>
          <SpringButton style={[styles.actBtn, styles.actDark]} onPress={goShortform}>
            <Text style={styles.actDarkText}>숏폼 만들기</Text>
          </SpringButton>
          <SpringButton style={[styles.actBtn, styles.actGold]} onPress={goItemList}>
            <Text style={styles.actGoldText}>아이템 목록</Text>
          </SpringButton>
        </View>
      </ScrollView>

      {/* 달성 퀘스트 상세 팝업 (screen 2) */}
      <GamePopup visible={!!selected} onClose={() => setSelected(null)}>
        <Image source={brand.appIconCheck} style={styles.popupCheck} />
        {/* ⭐ 수정: API 응답 필드(title/description/completed_at/reward_exp/reward_point)로 매핑 */}
        {selected && (
          <>
            <Text style={styles.popupTitle}>{selected.title}</Text>
            <Text style={styles.popupDesc}>{selected.description}</Text>
            <Text style={styles.popupTime}>퀘스트 완료 시간 : {formatCompletedAt(selected.completed_at)}</Text>
            <View style={styles.chipRow}>
              <Text style={[styles.chip, styles.chipExp]}>경험치 +{selected.reward_exp ?? 0}</Text>
              <Text style={[styles.chip, styles.chipPoint]}>포인트 +{selected.reward_point ?? 0}</Text>
            </View>
            <SpringButton style={styles.popupBtn} onPress={() => setSelected(null)}>
              <Text style={styles.popupBtnText}>확인 완료</Text>
            </SpringButton>
          </>
        )}
      </GamePopup>

      {/* ⭐ 수정: 프로필 수정(닉네임/관심카테고리) 모달 */}
      <GamePopup visible={editVisible} onClose={() => setEditVisible(false)} title="프로필 수정" width={320}>
        <View style={{ alignSelf: 'stretch' }}>
          <Text style={styles.editLabel}>닉네임</Text>
          <View style={styles.editNickRow}>
            <View style={{ flex: 1 }}>
              <GdqInput
                value={editNickname}
                onChangeText={(v) => {
                  setEditNickname(v);
                  if (editNickError) setEditNickError(null);
                  setEditNickOk(false);
                  setEditNickMsg(null);
                }}
                placeholder="닉네임을 입력하세요"
                maxLength={10}
              />
            </View>
            <SpringButton style={styles.editDupBtn} onPress={checkEditNickname} disabled={editNickChecking}>
              <Text style={styles.editDupText}>{editNickChecking ? '확인 중' : '중복확인'}</Text>
            </SpringButton>
          </View>
          {editNickMsg ? (
            <Text style={[styles.editFieldMsg, { color: editNickMsg.color }]}>{editNickMsg.text}</Text>
          ) : null}
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

  // profile card
  profileCard: {
    backgroundColor: colors.parchment,
    borderWidth: 2,
    borderColor: colors.pixelBorder,
    borderRadius: radii.card,
    paddingTop: 18,
    paddingBottom: 16,
    paddingHorizontal: 16,
    marginBottom: 20,
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
  // ⭐ 수정: 닉네임 + 프로필 수정 버튼 행 / 수정 모달 스타일
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  editBtn: {
    padding: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(92, 61, 30, 0.08)',
  },
  editLabel: { fontSize: 13, fontWeight: '700', color: colors.gold, marginBottom: 8, fontFamily: fonts.bodyB },
  editErrorText: { marginTop: 6, fontSize: 12, color: '#FF8A80', fontFamily: fonts.bodyM },
  editNickRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  editDupBtn: {
    height: 50,
    paddingHorizontal: 14,
    borderRadius: radii.input,
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editDupText: { color: colors.white, fontSize: 13, fontWeight: '600', fontFamily: fonts.bodyM },
  editFieldMsg: { marginTop: 8, marginLeft: 2, fontSize: 12, fontWeight: '600', fontFamily: fonts.bodyM },
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
  // ⭐ 수정: 프로필 로딩 스피너 / 아바타 업로드 중 오버레이
  profileInfoLoading: { alignSelf: 'flex-start' },
  avatarUploadOverlay: {
    ...StyleSheet.absoluteFill,
    borderRadius: 999,
    backgroundColor: 'rgba(3,50,54,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontSize: 18, fontWeight: '600', color: colors.primaryDark, fontFamily: fonts.bodyM },
  // ⭐ 수정: 칭호 + 관심카테고리를 한 줄에 배치
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1, marginBottom: 3 },
  title: { fontSize: 13, color: colors.gold, fontWeight: '600', fontFamily: fonts.bodyM },
  categoryText: { flexShrink: 1, fontSize: 11, color: colors.textMuted, fontFamily: fonts.bodyM },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lv: { fontFamily: fonts.pixel, fontSize: 15, color: colors.primaryDark },
  streak: { fontSize: 12, color: colors.xpGreen, fontWeight: '600', fontFamily: fonts.bodyM },

  // section
  sectionTitle: {
    fontFamily: fonts.pixel,
    fontSize: 16,
    color: colors.primaryDark,
    marginBottom: 12,
  },

  // timeline
  timelineCard: {
    backgroundColor: colors.white,
    borderRadius: 12,
    marginBottom: 14,
    overflow: 'hidden',
    shadowColor: '#033236',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  achRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF1F0',
    backgroundColor: colors.white,
  },
  achRowLast: { borderBottomWidth: 0 },
  achIcon: { width: 40, height: 40, borderRadius: 9 },
  achName: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.primaryDark, fontFamily: fonts.bodyM },
  achDate: { fontSize: 12, color: '#888', fontFamily: fonts.bodyR },
  // ⭐ 수정: 로딩/에러/빈 목록 상태 표시용
  timelineStateBox: { paddingVertical: 32, alignItems: 'center', justifyContent: 'center' },
  timelineStateText: { fontSize: 13, color: '#888', fontFamily: fonts.bodyM },
  // ⭐ 수정: 달성 내역 로드 실패 시 재시도 버튼
  retryBtn: {
    marginTop: 12,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: colors.primaryDark,
  },
  retryBtnText: { fontSize: 13, color: colors.parchment, fontFamily: fonts.bodyM },

  // actions
  actions: { flexDirection: 'row', gap: 10 },
  actBtn: { flex: 1, height: 50, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  actDark: { backgroundColor: colors.primaryDark },
  actDarkText: { color: colors.parchment, fontFamily: fonts.pixel, fontSize: 16 },
  actGold: { backgroundColor: colors.gold },
  actGoldText: { color: colors.primaryDark, fontFamily: fonts.pixel, fontSize: 16 },

  // popup
  popupCheck: { width: 72, height: 72, marginBottom: 14 },
  popupTitle: { fontFamily: fonts.pixel, fontSize: 20, color: '#F5ECCB', textAlign: 'center', marginBottom: 8 },
  popupDesc: { textAlign: 'center', fontSize: 14, color: '#B9C9BD', lineHeight: 21, marginBottom: 14, fontFamily: fonts.bodyR },
  popupTime: { textAlign: 'center', fontSize: 13, color: '#8FA79A', marginBottom: 16, fontFamily: fonts.bodyR },
  chipRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 20 },
  chip: { borderRadius: 24, paddingVertical: 6, paddingHorizontal: 14, fontSize: 13, fontWeight: '700', overflow: 'hidden', fontFamily: fonts.bodyB },
  chipExp: { backgroundColor: colors.xpGreen, color: colors.white },
  chipPoint: { backgroundColor: colors.gold, color: colors.primaryDark },
  popupBtn: {
    alignSelf: 'stretch',
    height: 48,
    borderRadius: 8,
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  popupBtnText: { color: colors.parchment, fontFamily: fonts.pixel, fontSize: 16 },
});
