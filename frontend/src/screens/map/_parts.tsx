import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  interpolate,
  Easing,
  FadeInDown,
} from 'react-native-reanimated';
import { colors, fonts, radii, gamePopup, CATEGORY_COLORS } from '../../theme';
import GamePopup from '../../components/GamePopup';
import PixelProgress from '../../components/PixelProgress';
import { PROVINCE_NAME_TO_CITY_ID, resolveCityId } from './provinceCityIds';
import { getRegionsByCity, RegionOption } from '../../api/map';

export const MAP = {
  fill: '#C8E6C9',
  fillSel: colors.gold,
  stroke: colors.pixelBorder,
  grid: 'rgba(255,255,255,0.4)',
  canvasA: '#DDEBE0',
  canvasB: '#CFE4D6',
  myRing: CATEGORY_COLORS.volunteer.accent,
};

const poly = (pts: number[][]) =>
  'M' + pts.map((p) => `${p[0]},${p[1]}`).join(' L') + ' Z';

const centroid = (pts: number[][]) => {
  const x = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const y = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  return { x, y };
};

export type Region = { key: string; label: string; team?: boolean; pts: number[][] };

export const REGIONS: Region[] = [
  { key: 'gyeonggi', label: '경기도', team: true, pts: [[92, 52], [142, 58], [152, 92], [132, 120], [96, 120], [76, 96], [80, 68]] },
  { key: 'seoul', label: '서울특별시', pts: [[104, 80], [124, 82], [126, 98], [106, 99]] },
  { key: 'incheon', label: '인천광역시', pts: [[64, 92], [82, 96], [82, 110], [62, 108]] },
  { key: 'gangwon', label: '강원도', pts: [[152, 50], [208, 58], [214, 102], [186, 120], [154, 108], [150, 78]] },
  { key: 'chungbuk', label: '충청북도', pts: [[134, 120], [164, 116], [172, 150], [144, 160], [130, 142]] },
  { key: 'chungnam', label: '충청남도', pts: [[70, 122], [130, 124], [130, 158], [100, 174], [70, 160]] },
  { key: 'jeonbuk', label: '전라북도', pts: [[74, 174], [130, 162], [142, 194], [112, 208], [78, 202]] },
  { key: 'jeonnam', label: '전라남도', pts: [[66, 206], [116, 206], [122, 242], [100, 270], [68, 260], [56, 228]] },
  { key: 'gyeongbuk', label: '경상북도', pts: [[152, 110], [204, 120], [210, 178], [174, 192], [146, 176], [146, 138]] },
  { key: 'gyeongnam', label: '경상남도', pts: [[126, 196], [196, 184], [202, 226], [174, 256], [130, 246], [122, 216]] },
  { key: 'busan', label: '부산광역시', pts: [[184, 248], [204, 250], [205, 268], [184, 268]] },
  { key: 'jeju', label: '제주특별자치도', pts: [[74, 300], [112, 298], [120, 314], [96, 328], [70, 318]] },
];

const TEAM_C = centroid(REGIONS[0].pts);

export const SIGUNGU: Region[] = [
  { key: 'goyang', label: '고양시', pts: [[70, 40], [112, 38], [118, 70], [88, 80], [66, 62]] },
  { key: 'bucheon', label: '부천시', pts: [[46, 82], [78, 80], [80, 108], [50, 112]] },
  { key: 'anyang', label: '안양시', team: true, pts: [[90, 84], [122, 80], [130, 108], [104, 120], [84, 104]] },
  { key: 'seongnam', label: '성남시', pts: [[134, 86], [166, 82], [174, 112], [146, 122], [132, 106]] },
  { key: 'ansan', label: '안산시', pts: [[52, 122], [88, 118], [90, 152], [58, 158]] },
  { key: 'suwon', label: '수원시', pts: [[96, 126], [128, 120], [136, 152], [110, 164], [92, 148]] },
  { key: 'yongin', label: '용인시', pts: [[140, 128], [186, 124], [194, 164], [158, 178], [138, 156]] },
];


function RegionPath({
  r,
  selected,
  onPress,
}: {
  r: Region;
  selected: boolean;
  onPress: (r: Region) => void;
}) {
  const hot = r.team || selected;
  return (
    <Path
      d={poly(r.pts)}
      fill={hot ? MAP.fillSel : MAP.fill}
      fillOpacity={hot ? 0.9 : 1}
      stroke={MAP.stroke}
      strokeWidth={hot ? 2 : 1.1}
      strokeLinejoin="round"
      onPress={() => onPress(r)}
    />
  );
}

export function NationalMap({
  onRegionPress,
  selectedKey,
}: {
  onRegionPress: (r: Region) => void;
  selectedKey?: string;
}) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 240 340" preserveAspectRatio="xMidYMid meet">
      {REGIONS.map((r) => (
        <RegionPath key={r.key} r={r} selected={selectedKey === r.key} onPress={onRegionPress} />
      ))}
      <Circle cx={TEAM_C.x} cy={TEAM_C.y} r={6} fill={colors.primaryDark} />
      <Circle cx={TEAM_C.x} cy={TEAM_C.y} r={2.4} fill={colors.parchment} />
    </Svg>
  );
}

export function GyeonggiMap({
  onRegionPress,
  selectedKey,
}: {
  onRegionPress: (r: Region) => void;
  selectedKey?: string;
}) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 240 210" preserveAspectRatio="xMidYMid meet">
      {SIGUNGU.map((r) => (
        <RegionPath key={r.key} r={r} selected={selectedKey === r.key} onPress={onRegionPress} />
      ))}
    </Svg>
  );
}


export function TeamPin({ label = '우리 팀 · 경기도', style }: { label?: string; style?: any }) {
  const bob = useSharedValue(0);
  useEffect(() => {
    bob.value = withRepeat(withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, []);
  const a = useAnimatedStyle(() => ({ transform: [{ translateY: interpolate(bob.value, [0, 1], [0, -5]) }] }));
  return (
    <Animated.View style={[styles.teamPinWrap, style, a]} pointerEvents="none">
      <View style={styles.teamPinPill}>
        <Text style={styles.teamPinText}>{label}</Text>
      </View>
      <View style={styles.teamPinTri} />
    </Animated.View>
  );
}

export function PulseRing({ color = colors.gold, size = 26, style }: { color?: string; size?: number; style?: any }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(withTiming(1, { duration: 1900, easing: Easing.out(Easing.ease) }), -1, false);
  }, []);
  const a = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 1], [0.7, 0]),
    transform: [{ scale: interpolate(p.value, [0, 1], [0.6, 2.4]) }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: color }, style, a]}
    />
  );
}

export function MapPinIcon({ size = 30 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z" fill={colors.gold} stroke="#A97D10" strokeWidth={1} />
      <Circle cx={12} cy={9} r={3} fill={colors.parchment} />
    </Svg>
  );
}

export function ChevronDown({ size = 18, color = colors.gold }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M6 9l6 6 6-6" />
    </Svg>
  );
}

export function SearchIcon({ size = 18, color = colors.primaryDark }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round">
      <Circle cx={11} cy={11} r={7} />
      <Path d="M21 21l-4-4" />
    </Svg>
  );
}

export function PinDot({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={colors.primaryDark}>
      <Path d="M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z" />
      <Circle cx={12} cy={9} r={2.5} fill={colors.parchment} />
    </Svg>
  );
}


const RANK_COLORS = [colors.gold, '#A8A8A8', '#CD7F32'];
const rankColor = (index: number) => RANK_COLORS[index] ?? colors.textSecondary;

export function RankRow({
  name,
  score,
  pct,
  index,
  subtitle,
  onPress,
}: {
  name: string;
  score: string;
  pct: number;
  index: number;
  subtitle?: string;
  onPress?: () => void;
}) {
  return (
    <Animated.View entering={FadeInDown.delay(50 + index * 60).duration(420)}>
      <Pressable onPress={onPress} style={({ pressed }) => [styles.rankRow, pressed && styles.rowPressed]}>
        <View style={styles.rankTop}>
          <Text style={[styles.medal, { color: rankColor(index), fontSize: index < 3 ? 18 : 15 }]}>{index + 1}</Text>
          <View style={styles.rankNameWrap}>
            <Text style={styles.rankName}>{name}</Text>
            {subtitle ? <Text style={styles.rankSubtitle}>{subtitle}</Text> : null}
          </View>
          <Text style={styles.rankScore}>{score}점</Text>
        </View>
        <View style={styles.barWrap}>
          <PixelProgress progress={pct} height={6} color={colors.gold} track="#EEF1F0" />
        </View>
      </Pressable>
    </Animated.View>
  );
}

export function UserRankRow({
  rank,
  name,
  xp,
  index,
  onPress,
}: {
  rank: string;
  name: string;
  xp: string;
  index: number;
  onPress?: () => void;
}) {
  return (
    <Animated.View entering={FadeInDown.delay(50 + index * 70).duration(420)}>
      <Pressable style={({ pressed }) => [styles.userRow, pressed && styles.rowPressed]} onPress={onPress}>
        <Text style={[styles.userRank, { color: rankColor(index), fontSize: index < 3 ? 15 : 13 }]}>
          {index === 0 ? '🏆 ' : ''}{rank}
        </Text>
        <Text style={styles.userName}>{name}</Text>
        <Text style={styles.userXp}>{xp} XP</Text>
      </Pressable>
    </Animated.View>
  );
}


const SIDO_LIST = Object.keys(PROVINCE_NAME_TO_CITY_ID);

export function TeamSelectPopup({
  visible,
  onClose,
  onConfirm,
  region = '경기도',
  city = '안양시',
  submitting = false,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: (regionId: number, sido: string, sigunguName: string) => void;
  region?: string;
  city?: string;
  submitting?: boolean;
}) {
  const [sido, setSido] = useState(region);
  const [sigunguOptions, setSigunguOptions] = useState<RegionOption[]>([]);
  const [selected, setSelected] = useState<RegionOption | null>(null);
  const [sidoOpen, setSidoOpen] = useState(false);
  const [sigunguOpen, setSigunguOpen] = useState(false);
  const [loadingRegions, setLoadingRegions] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRegions = useCallback(async (sidoName: string, preferName?: string) => {
    const cityId = resolveCityId(sidoName);
    if (cityId === null) {
      setSigunguOptions([]);
      setSelected(null);
      return;
    }
    setLoadingRegions(true);
    setError(null);
    try {
      const options = await getRegionsByCity(cityId);
      setSigunguOptions(options);
      const preferred = preferName ? options.find((o) => o.region_name === preferName) : undefined;
      setSelected(preferred ?? options[0] ?? null);
    } catch {
      setSigunguOptions([]);
      setSelected(null);
      setError('지역 목록을 불러오지 못했어요.');
    } finally {
      setLoadingRegions(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      setSido(region);
      setError(null);
      loadRegions(region, city);
    }
  }, [visible, region, city, loadRegions]);

  const handleConfirm = () => {
    if (!selected || submitting) return;
    onConfirm(selected.region_id, sido, selected.region_name);
  };

  return (
    <GamePopup visible={visible} onClose={onClose} title="참여 지역 선택" width={320}>
      <View style={{ alignSelf: 'stretch' }}>
        <Pressable
          style={styles.selRow}
          onPress={() => {
            setSidoOpen((o) => !o);
            setSigunguOpen(false);
          }}
        >
          <Text style={styles.selText}>{sido}</Text>
          <ChevronDown />
        </Pressable>
        {sidoOpen ? (
          <View style={styles.dropdown}>
            <ScrollView style={{ maxHeight: 170 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
              {SIDO_LIST.map((s) => (
                <Pressable
                  key={s}
                  style={styles.dropItem}
                  onPress={() => {
                    setSido(s);
                    setSidoOpen(false);
                    loadRegions(s);
                  }}
                >
                  <Text style={[styles.dropText, s === sido && styles.dropActive]}>{s}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}

        <Pressable
          style={styles.selRow}
          onPress={() => {
            if (loadingRegions) return;
            setSigunguOpen((o) => !o);
            setSidoOpen(false);
          }}
        >
          {loadingRegions ? (
            <ActivityIndicator size="small" color={gamePopup.cream} />
          ) : (
            <Text style={styles.selText}>{selected?.region_name ?? '선택 없음'}</Text>
          )}
          <ChevronDown />
        </Pressable>
        {sigunguOpen ? (
          <View style={styles.dropdown}>
            <ScrollView style={{ maxHeight: 170 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
              {sigunguOptions.map((sg) => (
                <Pressable
                  key={sg.region_id}
                  style={styles.dropItem}
                  onPress={() => {
                    setSelected(sg);
                    setSigunguOpen(false);
                  }}
                >
                  <Text style={[styles.dropText, sg.region_id === selected?.region_id && styles.dropActive]}>
                    {sg.region_name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Pressable
          style={[styles.confirmBtn, (!selected || submitting) && styles.confirmBtnDisabled]}
          onPress={handleConfirm}
          disabled={!selected || submitting}
        >
          {submitting ? (
            <ActivityIndicator size="small" color={colors.parchment} />
          ) : (
            <Text style={styles.confirmText}>확인</Text>
          )}
        </Pressable>
      </View>
    </GamePopup>
  );
}

const styles = StyleSheet.create({
  teamPinWrap: { position: 'absolute', alignItems: 'center', zIndex: 3 },
  teamPinPill: {
    backgroundColor: colors.gold,
    borderWidth: 1.5,
    borderColor: '#A97D10',
    borderRadius: radii.pill,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  teamPinText: { fontFamily: fonts.pixel, fontSize: 11, color: '#3A2A12' },
  teamPinTri: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#C99A20',
    marginTop: -1,
  },
  rankRow: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  rowPressed: { backgroundColor: '#F4F9F5' },
  rankTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  medal: { width: 30, textAlign: 'center', fontFamily: fonts.pixel, fontSize: 18, color: colors.primaryDark },
  rankNameWrap: { flex: 1 },
  rankName: { fontWeight: '600', fontSize: 15, color: colors.primaryDark, fontFamily: fonts.bodyM },
  rankSubtitle: { fontSize: 11, color: colors.textSecondary, fontFamily: fonts.bodyR, marginTop: 2 },
  rankScore: { fontFamily: fonts.pixel, fontSize: 13, color: colors.gold },
  barWrap: { paddingLeft: 42 },
  userRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#EFE6CC' },
  userRank: { width: 56, fontFamily: fonts.pixel, fontSize: 14, color: colors.primaryDark },
  userName: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.textPrimary, fontFamily: fonts.bodyM },
  userXp: { fontWeight: '800', fontSize: 14, color: colors.xpGreen, fontFamily: fonts.bodyB },
  selRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1.5,
    borderColor: gamePopup.innerRing,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 12,
  },
  selText: { fontSize: 15, color: gamePopup.cream, fontFamily: fonts.bodyM },
  confirmBtn: {
    height: 48,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.gold,
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  confirmBtnDisabled: { opacity: 0.5 },
  confirmText: { fontFamily: fonts.pixel, fontSize: 16, color: colors.parchment },
  dropdown: {
    marginTop: -6,
    marginBottom: 10,
    backgroundColor: colors.parchment,
    borderWidth: 1.5,
    borderColor: colors.gold,
    borderRadius: 10,
    overflow: 'hidden',
  },
  dropItem: { paddingVertical: 11, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(92,61,30,0.12)' },
  dropText: { fontSize: 14, fontFamily: fonts.bodyR, color: colors.textPrimary },
  dropActive: { color: '#8A6A1E', fontFamily: fonts.bodyB },
  errorText: { color: '#E08A8A', fontSize: 12, fontFamily: fonts.bodyR, marginBottom: 8, textAlign: 'center' },
});