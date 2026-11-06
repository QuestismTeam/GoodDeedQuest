/**
 * Admin flow (09) — screen-local shared bits.
 * Colors/typography reuse ../../theme where an exact token exists; the admin-only
 * hexes below (#FF4444 admin-red, card borders, chart greys, popup creams) are
 * verbatim from 09_admin_flow.dc.html and have no theme equivalent.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, DimensionValue, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Circle, Line, Text as SvgText, G } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
  useAnimatedReaction,
  withTiming,
  withDelay,
  withRepeat,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { colors, fonts } from '../../theme';
import Shimmer from '../../components/Shimmer';
import GamePopup, { PopupButtons } from '../../components/GamePopup';

/* ─────────────────────────  admin-only tokens (from .dc.html)  ───────────────────────── */
export const AD = {
  red: '#FF4444', // admin red — distinct from theme.danger (#E53935); used verbatim in .dc.html
  cardBorder: '#E0E0E0',
  muted: '#888888',
  chartGrid: '#E0E0E0',
  axisLabel: '#AAB2AC',
  detailInfoBg: '#F8F8F8',
  imgBg: '#F0F0F0',
  reportedCardBorder: '#D6E7DC',
  popupCream: '#F5ECCB',
  popupInfoText: '#DCE7DB',
  popupUserBg: 'rgba(255,255,255,0.08)',
  popupInfoBg: 'rgba(0,0,0,0.25)',
  popupSecondaryBorder: '#5C6B60',
} as const;

// 135deg avatar gradients (placeholder art — inline colors only, no image assets)
export const AVATARS: [string, string][] = [
  ['#4CAF50', '#2E7D32'],
  ['#5B9BD5', '#2E5A9B'],
  ['#E57373', '#B04A4A'],
  ['#FF9E5A', '#B96A28'],
  ['#B27BD0', '#7A4A9B'],
];

/* ─────────────────────────  types + mock data  ───────────────────────── */
export type AdminUser = { id: string; name: string; title: string; lv: number; blocked: boolean; av: [string, string] };
export type AdminReport = { id: string; name: string; reporter: string; date: string; isNew: boolean; av: [string, string] };

const USER_SEED: [string, string, number, boolean][] = [
  ['선한김철수', '마을 수호자', 12, false],
  ['에코리', '새싹 지킴이', 8, false],
  ['문제유저01', '알 수 없음', 4, true],
  ['봉사왕', '선한 영웅', 15, false],
  ['초록마음', '나눔 천사', 6, false],
];
const NAME_POOL = ['별빛나눔', '햇살봉사', '푸른하루', '온기지기', '달빛수호', '새싹영웅', '맑은마음', '너른품', '고운손길', '숲속지기'];
const TITLE_POOL = ['마을 수호자', '새싹 지킴이', '선한 영웅', '나눔 천사', '숲의 친구', '거리 지킴이'];

export function makeUsers(page: number, count = 6): AdminUser[] {
  if (page === 0) {
    return USER_SEED.map((a, i) => ({
      id: `u0-${i}`, name: a[0], title: a[1], lv: a[2], blocked: a[3], av: AVATARS[i % AVATARS.length],
    }));
  }
  return Array.from({ length: count }, (_, i) => {
    const g = page * 100 + i;
    return {
      id: `u${page}-${i}`,
      name: NAME_POOL[g % NAME_POOL.length] + (g % 17),
      title: TITLE_POOL[g % TITLE_POOL.length],
      lv: 3 + (g % 20),
      blocked: g % 7 === 0,
      av: AVATARS[g % AVATARS.length],
    };
  });
}

const REPORT_SEED: [string, string, string, boolean][] = [
  ['문제유저01', 'user_kim', '2026.07.10', true],
  ['광고봇22', 'green_lee', '2026.07.10', true],
  ['스팸계정', 'sunny', '2026.07.08', false],
  ['악성유저', 'kind_kim', '2026.07.05', false],
];
const RNAME_POOL = ['도배계정', '홍보봇', '불량유저', '허위신고', '중복업로드', '욕설계정', '사칭유저'];
const REPORTER_POOL = ['user_park', 'eco_lee', 'sunny', 'kind_kim', 'green_choi', 'blue_han'];

export function makeReports(page: number, count = 6): AdminReport[] {
  if (page === 0) {
    return REPORT_SEED.map((a, i) => ({
      id: `r0-${i}`, name: a[0], reporter: a[1], date: a[2], isNew: a[3], av: AVATARS[(i + 2) % AVATARS.length],
    }));
  }
  return Array.from({ length: count }, (_, i) => {
    const g = page * 100 + i;
    const d = 4 - (g % 4);
    return {
      id: `r${page}-${i}`,
      name: RNAME_POOL[g % RNAME_POOL.length] + (g % 23),
      reporter: REPORTER_POOL[g % REPORTER_POOL.length],
      date: `2026.07.0${d}`,
      isNew: false,
      av: AVATARS[(g + 2) % AVATARS.length],
    };
  });
}

/* ─────────────────────────  Avatar (gradient placeholder)  ───────────────────────── */
export function Avatar({ av, size = 48 }: { av: [string, string]; size?: number }) {
  return (
    <LinearGradient
      colors={av}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ width: size, height: size, borderRadius: size / 2 }}
    />
  );
}

/* ─────────────────────────  icons (ported 1:1 from .dc.html)  ───────────────────────── */
export const MegaphoneIcon = ({ size = 20, color = colors.gold }: { size?: number; color?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M3 11v2l13 5V6L3 11z" />
    <Path d="M16 8a4 4 0 0 1 0 8" />
  </Svg>
);
export const ChevronDown = ({ size = 15, color = colors.primaryDark }: { size?: number; color?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M6 9l6 6 6-6" />
  </Svg>
);
export const SearchIcon = ({ size = 18, color = colors.primaryDark }: { size?: number; color?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round">
    <Circle cx={11} cy={11} r={7} />
    <Path d="M21 21l-4-4" />
  </Svg>
);

/* ─────────────────────────  count-up number (stat cards)  ───────────────────────── */
function group(n: number) {
  const neg = n < 0;
  const s = Math.abs(Math.round(n)).toString();
  let out = '';
  let c = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    out = s[i] + out;
    c++;
    if (c % 3 === 0 && i > 0) out = ',' + out;
  }
  return (neg ? '-' : '') + out;
}

export function CountUp({ target, delay = 0, style }: { target: number; delay?: number; style?: any }) {
  const [val, setVal] = useState(0);
  const sv = useSharedValue(0);
  useEffect(() => {
    sv.value = withDelay(delay, withTiming(target, { duration: 1000, easing: Easing.out(Easing.cubic) }));
  }, []);
  useAnimatedReaction(
    () => sv.value,
    (cur) => runOnJS(setVal)(Math.round(cur)),
  );
  return <Text style={style}>{group(val)}</Text>;
}

/* ─────────────────────────  pulsing "loading more" dots (ad-dot)  ───────────────────────── */
function Dot({ delay }: { delay: number }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(delay, withRepeat(withTiming(1, { duration: 600, easing: Easing.inOut(Easing.ease) }), -1, true));
  }, []);
  const st = useAnimatedStyle(() => ({ opacity: 0.4 + 0.6 * p.value, transform: [{ scale: 0.8 + 0.2 * p.value }] }));
  return <Animated.View style={[styles.dot, st]} />;
}
export function LoadingDots({ style }: { style?: any }) {
  return (
    <View style={[styles.dotsRow, style]}>
      <Dot delay={0} />
      <Dot delay={200} />
      <Dot delay={400} />
    </View>
  );
}

/* ─────────────────────────  NEW badge (pulse ad-newpulse)  ───────────────────────── */
export function NewBadge() {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, []);
  const st = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.12 * p.value }] }));
  return (
    <Animated.View style={[styles.newBadge, st]}>
      <Text style={styles.newText}>NEW</Text>
    </Animated.View>
  );
}

/* ─────────────────────────  banner gold glow pulse (ad-bannerglow)  ───────────────────────── */
export function BannerGlow() {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, []);
  const st = useAnimatedStyle(() => ({ opacity: 0.25 + 0.75 * p.value }));
  return <Animated.View pointerEvents="none" style={[styles.bannerGlow, st]} />;
}

/* ─────────────────────────  7-day activity line chart (react-native-svg)  ───────────────────────── */
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const CW = 340, CH = 190, padL = 30, padR = 12, padT = 12, padB = 26;
const DAYS = ['5/14', '5/15', '5/16', '5/17', '5/18', '5/19', '5/20'];
const VALS = [180, 320, 260, 480, 420, 560, 610];
const MAXV = 600;
const cx = (i: number) => padL + (CW - padL - padR) * (i / (DAYS.length - 1));
const cy = (v: number) => CH - padB - (CH - padB - padT) * (v / MAXV);
const LINE_PATH = VALS.map((v, i) => (i ? 'L' : 'M') + cx(i).toFixed(1) + ' ' + cy(v).toFixed(1)).join(' ');
const LINE_LEN = (() => {
  let len = 0;
  for (let i = 1; i < VALS.length; i++) len += Math.hypot(cx(i) - cx(i - 1), cy(VALS[i]) - cy(VALS[i - 1]));
  return Math.ceil(len);
})();

function ChartDot({ x, y, delay }: { x: number; y: number; delay: number }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(delay, withTiming(1, { duration: 300, easing: Easing.out(Easing.back(2)) }));
  }, []);
  const props = useAnimatedProps(() => ({ r: 3.5 * p.value, opacity: p.value }));
  return <AnimatedCircle cx={x} cy={y} fill={colors.gold} animatedProps={props} />;
}

export function ActivityChart() {
  const draw = useSharedValue(0);
  useEffect(() => {
    draw.value = withTiming(1, { duration: 1400, easing: Easing.out(Easing.cubic) });
  }, []);
  const lineProps = useAnimatedProps(() => ({ strokeDashoffset: LINE_LEN * (1 - draw.value) }));
  return (
    <View style={{ width: '100%', aspectRatio: CW / CH }}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${CW} ${CH}`}>
        {[0, 200, 400, 600].map((g) => (
          <G key={'g' + g}>
            <Line x1={padL} y1={cy(g)} x2={CW - padR} y2={cy(g)} stroke={AD.chartGrid} strokeWidth={1} strokeDasharray="3 3" />
            <SvgText x={padL - 6} y={cy(g) + 3} fontSize={9} fill={AD.axisLabel} textAnchor="end">{String(g)}</SvgText>
          </G>
        ))}
        <AnimatedPath
          d={LINE_PATH}
          fill="none"
          stroke={colors.primaryDark}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={LINE_LEN}
          animatedProps={lineProps}
        />
        {VALS.map((v, i) => (
          <ChartDot key={'c' + i} x={cx(i)} y={cy(v)} delay={900 + i * 80} />
        ))}
        {DAYS.map((d, i) => (
          <SvgText key={'t' + i} x={cx(i)} y={CH - 8} fontSize={9} fill={AD.muted} textAnchor="middle">{d}</SvgText>
        ))}
      </Svg>
    </View>
  );
}

/* ─────────────────────────  skeleton rows (shimmer while "loading")  ───────────────────────── */
export function SkeletonCard({ height = 74 }: { height?: number }) {
  return (
    <View style={[styles.skelCard, { minHeight: height }]}>
      <Shimmer width={48} height={48} radius={24} />
      <View style={{ flex: 1, gap: 8 }}>
        <Shimmer width={'55%' as DimensionValue} height={13} />
        <Shimmer width={'38%' as DimensionValue} height={11} />
        <Shimmer width={'24%' as DimensionValue} height={10} />
      </View>
    </View>
  );
}

/* ─────────────────────────  차단/삭제 확인 팝업 (3A) — shared confirm dialog  ───────────────────────── */
export type ConfirmAction =
  | 'block'
  | 'delete'
  | 'reject'
  | null;

export function ConfirmPopup({
  action,
  onConfirm,
  onCancel,
}: {
  action: ConfirmAction;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { width } = useWindowDimensions();

  const confirmMessage =
    action === 'delete'
      ? '삭제하시겠습니까?'
      : action === 'reject'
        ? '신고를 반려하시겠습니까?'
        : '차단하시겠습니까?';

  return (
    <GamePopup
      visible={!!action}
      onClose={onCancel}
      width={width - 48}
    >
      <View style={{ alignSelf: 'stretch' }}>
        <Text style={styles.confirmText}>
          {confirmMessage}
        </Text>

        <PopupButtons
          primaryLabel="예"
          onPrimary={onConfirm}
          secondaryLabel="아니오"
          onSecondary={onCancel}
        />
      </View>
    </GamePopup>
  );
}

const styles = StyleSheet.create({
  confirmText: { textAlign: 'center', fontFamily: fonts.pixel, fontSize: 16, color: AD.popupCream, marginBottom: 4 },
  dotsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.primaryDark },
  newBadge: { backgroundColor: AD.red, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  newText: { color: colors.white, fontSize: 11, fontWeight: '600', fontFamily: fonts.bodyB },
  bannerGlow: {
    ...StyleSheet.absoluteFill,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.gold,
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
  },
  skelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: AD.cardBorder,
    borderRadius: 12,
    padding: 12,
  },
});
