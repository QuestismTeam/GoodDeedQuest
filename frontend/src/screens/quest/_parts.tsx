/**
 * Quest flow (02) — screen-local subcomponents & helpers.
 * Ported 1:1 from 02_quest_flow.dc.html (pixel coin/star/sword/camera glyphs,
 * difficulty chips, bot avatar, typing dots, AI spinner, quest-start iris/scale
 * wipe transition, count-up hook). transform/opacity motion only (Reanimated).
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Rect, Path, Circle } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withDelay,
  withSequence,
  interpolate,
  Easing,
} from 'react-native-reanimated';
import { fonts } from '../../theme';

/* ───────────────── pixel glyphs (px() in renderVals) ───────────────── */

type Row = [number, number, number, number, string?];
function PixRects({ rows, vb, size, color }: { rows: Row[]; vb: number; size: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${vb} ${vb}`}>
      {rows.map((r, i) => (
        <Rect key={i} x={r[0]} y={r[1]} width={r[2]} height={r[3]} fill={r[4] || color} />
      ))}
    </Svg>
  );
}

const COIN_ROWS: Row[] = [[2, 1, 4, 1, '#A97D10'], [1, 2, 6, 4, '#D4A017'], [2, 6, 4, 1, '#A97D10'], [2, 2, 1, 1, '#F1C94B']];
const COIN_W_ROWS: Row[] = [[2, 1, 4, 1, '#EED9A0'], [1, 2, 6, 4, '#FFFFFF'], [2, 6, 4, 1, '#EED9A0'], [2, 2, 1, 1, '#FFFFFF']];
const STAR_ROWS: Row[] = [[3, 0, 2, 2], [2, 2, 4, 1], [0, 2, 8, 1], [1, 3, 6, 1], [2, 4, 4, 1], [1, 5, 2, 1], [5, 5, 2, 1]];

export const Coin = ({ size = 13 }: { size?: number }) => <PixRects rows={COIN_ROWS} vb={8} size={size} color="#D4A017" />;
export const CoinW = ({ size = 14 }: { size?: number }) => <PixRects rows={COIN_W_ROWS} vb={8} size={size} color="#fff" />;
export const Star = ({ size = 13, color = '#4CAF50' }: { size?: number; color?: string }) => <PixRects rows={STAR_ROWS} vb={8} size={size} color={color} />;
export const StarW = ({ size = 14 }: { size?: number }) => <PixRects rows={STAR_ROWS} vb={8} size={size} color="#FFFFFF" />;

/* line icons */
export const CameraIcon = ({ size = 20, color = '#fff' }: { size?: number; color?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M4 8h3l1.5-2h7L17 8h3v11H4z" />
    <Circle cx={12} cy={13} r={3.2} />
  </Svg>
);

export const AiIcon = ({ size = 18, color = '#033236' }: { size?: number; color?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Rect x={5} y={7} width={14} height={12} rx={3} />
    <Path d="M12 3v4M9 12h.01M15 12h.01" />
    <Path d="M9 16c1 1 5 1 6 0" />
  </Svg>
);

export const ChevRight = ({ size = 18, color = '#9CA3AF' }: { size?: number; color?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M9 5l7 7-7 7" />
  </Svg>
);

export const ChevLeft = ({ size = 18, color = '#9CA3AF' }: { size?: number; color?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M15 5l-7 7 7 7" />
  </Svg>
);

/** grey pixel scroll — empty state (emptyScroll). */
export const EmptyScroll = ({ size = 46 }: { size?: number }) => (
  <PixRects
    vb={12}
    size={size}
    color="#ccc"
    rows={[[2, 1, 8, 1, '#C7CDC9'], [1, 2, 10, 1, '#B7BEB9'], [2, 3, 8, 5, '#DDE2DE'], [1, 8, 10, 1, '#B7BEB9'], [2, 9, 8, 1, '#C7CDC9'], [4, 4, 4, 1, '#AEB6B0'], [4, 6, 5, 1, '#AEB6B0']]}
  />
);

/** robot bot avatar (teal circle) — chat. */
export const BotAvatar = () => (
  <View style={styles.botAvatar}>
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#7FD69A" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={5} y={8} width={14} height={11} rx={3} />
      <Path d="M12 4v4M9 13h.01M15 13h.01" />
    </Svg>
  </View>
);

/* ───────────────── difficulty chip ───────────────── */

const DIFF: Record<string, [string, string, string]> = {
  쉬움: ['#E7F6EA', '#2E7D32', '#4CAF50'],
  보통: ['#FDF3E0', '#9A6B00', '#D4A017'],
  어려움: ['#FDE8E8', '#C62828', '#E53935'],
};

export function DiffChip({ diff }: { diff: string }) {
  const [bg, fg, bd] = DIFF[diff] || DIFF['보통'];
  return (
    <View style={[styles.diffChip, { backgroundColor: bg, borderColor: bd }]}>
      <Text style={[styles.diffText, { color: fg }]}>{diff}</Text>
    </View>
  );
}

/* ───────────────── typing dots (3-dot wave) ───────────────── */

function Dot({ delay }: { delay: number }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withDelay(delay, withRepeat(withTiming(1, { duration: 600, easing: Easing.inOut(Easing.ease) }), -1, true));
  }, []);
  const st = useAnimatedStyle(() => ({ transform: [{ translateY: -4 * v.value }], opacity: 0.4 + 0.6 * v.value }));
  return <Animated.View style={[styles.dot, st]} />;
}

export function TypingBubble() {
  return (
    <View style={styles.typingRow}>
      <BotAvatar />
      <View style={styles.typingBubble}>
        <Dot delay={0} />
        <Dot delay={200} />
        <Dot delay={400} />
      </View>
    </View>
  );
}

/* ───────────────── AI analysis spinner (spin) ───────────────── */

export function SpinnerRing({ size = 20 }: { size?: number }) {
  const r = useSharedValue(0);
  useEffect(() => {
    r.value = withRepeat(withTiming(1, { duration: 800, easing: Easing.linear }), -1, false);
  }, []);
  const st = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value * 360}deg` }] }));
  return (
    <Animated.View
      style={[
        { width: size, height: size, borderRadius: size / 2, borderWidth: 3, borderColor: '#CBD5D0', borderTopColor: '#033236' },
        st,
      ]}
    />
  );
}

/* ───────────────── floating spark (gdq-float2) — active card ambience ───────────────── */

export function FloatSpark({ left, top, delay, size = 11, glyph = '✦', color = '#D4A017' }: { left: string; top: string; delay: number; size?: number; glyph?: string; color?: string }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2800, easing: Easing.inOut(Easing.ease) }), -1, false));
  }, []);
  const st = useAnimatedStyle(() => ({
    opacity: interpolate(v.value, [0, 0.25, 0.75, 1], [0, 1, 1, 0]),
    transform: [{ translateY: interpolate(v.value, [0, 1], [4, -30]) }, { scale: interpolate(v.value, [0, 1], [0.7, 1]) }],
  }));
  return (
    <Animated.Text style={[{ position: 'absolute', left: left as any, top: top as any, fontSize: size, color, zIndex: 1 }, st]}>
      {glyph}
    </Animated.Text>
  );
}

/** gentle vertical bob (gdq-bob2). */
export function Bob({ children, amp = 4, dur = 2600, style }: { children: React.ReactNode; amp?: number; dur?: number; style?: any }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withRepeat(withTiming(1, { duration: dur, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, []);
  const st = useAnimatedStyle(() => ({ transform: [{ translateY: -amp * v.value }] }));
  return <Animated.View style={[style, st]}>{children}</Animated.View>;
}

/* ───────────────── quest-start iris/scale wipe (gdq-iris + gdq-transtext + sparks) ───────────────── */

const TRANS_DIRS: [number, number][] = [[0, -120], [90, -80], [120, 10], [80, 90], [0, 120], [-80, 90], [-120, 10], [-90, -80]];

function TransSpark({ dx, dy, i }: { dx: number; dy: number; i: number }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withDelay(150, withTiming(1, { duration: 1000, easing: Easing.out(Easing.ease) }));
  }, []);
  const st = useAnimatedStyle(() => ({
    opacity: interpolate(v.value, [0, 0.4, 1], [0, 1, 0]),
    transform: [{ translateX: dx * v.value }, { translateY: dy * v.value }, { scale: interpolate(v.value, [0, 1], [0, 1]) }],
  }));
  return <Animated.View style={[{ position: 'absolute', width: 8, height: 8, backgroundColor: i % 2 ? '#D4A017' : '#4CAF50' }, st]} />;
}

export function StartTransition({ onDone }: { onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const iris = useSharedValue(0);
  const tv = useSharedValue(0);
  const D = Math.max(width, height) * 2.4; // circle big enough to cover screen

  useEffect(() => {
    iris.value = withTiming(1, { duration: 1150, easing: Easing.bezier(0.4, 0, 0.2, 1) });
    tv.value = withSequence(
      withTiming(1, { duration: 345, easing: Easing.out(Easing.ease) }),
      withDelay(460, withTiming(0, { duration: 345, easing: Easing.in(Easing.ease) }))
    );
    const t = setTimeout(onDone, 1150);
    return () => clearTimeout(t);
  }, []);

  const irisStyle = useAnimatedStyle(() => ({ transform: [{ scale: iris.value }] }));
  const textStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tv.value, [0, 0.3, 1], [0, 1, 1]),
    transform: [{ scale: interpolate(tv.value, [0, 0.3, 1], [0.4, 1.08, 1]) }],
  }));

  return (
    <View style={styles.transRoot} pointerEvents="none">
      <Animated.View style={[{ position: 'absolute', width: D, height: D, borderRadius: D / 2, top: '46%', left: '50%', marginLeft: -D / 2, marginTop: -D / 2 }, irisStyle]}>
        <LinearGradient colors={['#0E3A31', '#052018']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={{ flex: 1, borderRadius: D / 2 }} />
      </Animated.View>
      <View style={styles.transCenter}>
        <Animated.Text style={[styles.transText, textStyle]}>퀘스트 시작!</Animated.Text>
        <View style={{ width: 0, height: 0 }}>
          {TRANS_DIRS.map(([dx, dy], i) => (
            <TransSpark key={i} dx={dx} dy={dy} i={i} />
          ))}
        </View>
      </View>
    </View>
  );
}

/* ───────────────── count-up hook (XP Count) ───────────────── */

export function useCountUp(target: number, duration = 900, run = true) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!run) {
      setVal(0);
      return;
    }
    let raf = 0;
    const t0 = Date.now();
    const tick = () => {
      const p = Math.min(1, (Date.now() - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, run]);
  return val;
}

const styles = StyleSheet.create({
  botAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#033236', alignItems: 'center', justifyContent: 'center' },
  diffChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  diffText: { fontSize: 10, fontWeight: '700', fontFamily: fonts.bodyB },
  typingRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  typingBubble: {
    flexDirection: 'row',
    gap: 5,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#EDF1EF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#9CA3AF' },
  transRoot: { ...StyleSheet.absoluteFill, zIndex: 40, overflow: 'hidden' },
  transCenter: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 12 },
  transText: {
    fontFamily: fonts.pixel,
    fontSize: 30,
    color: '#F5EFD8',
    letterSpacing: 2,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 0,
  },
});
