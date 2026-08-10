import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, { FadeIn } from 'react-native-reanimated';
import { colors, fonts } from '../theme';

type PathDef = { name: string; d: string };
type MapDef = { viewBox: string; paths: PathDef[] };
type DrillData = { national: MapDef; provinces: Record<string, MapDef> };

const DRILL: DrillData = require('../../assets/maps/korea_drilldown.json');

const MAP_COLORS = {
  landFill: '#E3EFE4',
  landStroke: '#A9C2B2',
  team: '#D4A017',
  teamStroke: '#8A6A1E',
  selected: '#0A4F55',
  sigunguFill: '#F5EDD6',
  sigunguStroke: '#CBB27A',
  sigunguTeam: '#D4A017',
};

function vbSize(vb: string) {
  const p = vb.split(/\s+/).map(Number);
  return { x: p[0] || 0, y: p[1] || 0, w: p[2] || 800, h: p[3] || 760 };
}

type Box = { minX: number; minY: number; maxX: number; maxY: number; area: number };

function dominantBox(d: string): Box | null {
  let best: Box | null = null;
  for (const sub of d.split('M')) {
    const nums = (sub.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    if (nums.length < 4) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const x = nums[i], y = nums[i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const area = (maxX - minX) * (maxY - minY);
    if (!best || area > best.area) best = { minX, minY, maxX, maxY, area };
  }
  return best;
}

function provinceKey(name: string): string | null {
  if (DRILL.provinces[name]) return name;
  const pre = name.slice(0, 2);
  const hit = Object.keys(DRILL.provinces).find((k) => k.startsWith(pre));
  return hit ?? null;
}

export default function KoreaMapDrilldown({
  teamRegion = '경기도',
  teamSigungu = '안양시',
  onRegion,
  onSigungu,
  height = 300,
  initialProvince,
  allowNational = true,
  drillOnRegionTap = true,
}: {
  teamRegion?: string;
  teamSigungu?: string;
  onRegion?: (name: string) => void;
  onSigungu?: (name: string, province: string) => void;
  height?: number;
  initialProvince?: string;
  allowNational?: boolean;
  drillOnRegionTap?: boolean;
}) {
  const { width } = useWindowDimensions();
  const [province, setProvince] = useState<string | null>(
    initialProvince ? provinceKey(initialProvince) : null
  );
  const [pressed, setPressed] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [measuredW, setMeasuredW] = useState(0);

  const map = province && DRILL.provinces[province] ? DRILL.provinces[province] : DRILL.national;

  const vb = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of map.paths) {
      const b = dominantBox(p.d);
      if (!b) continue;
      if (b.minX < minX) minX = b.minX;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.minY < minY) minY = b.minY;
      if (b.maxY > maxY) maxY = b.maxY;
    }
    if (!isFinite(minX)) return vbSize(map.viewBox);
    const padX = (maxX - minX) * 0.06;
    const padY = (maxY - minY) * 0.06;
    return {
      x: minX - padX,
      y: minY - padY,
      w: maxX - minX + padX * 2,
      h: maxY - minY + padY * 2,
    };
  }, [map, province]);

  const availW = measuredW > 0 ? measuredW : Math.min(width - 64, 360);
  const maxH = Math.max(height, 200);
  let boxW = availW;
  let svgH = (boxW * vb.h) / vb.w;
  if (svgH > maxH) {
    svgH = maxH;
    boxW = (maxH * vb.w) / vb.h;
  }

  const onLandPress = (name: string) => {
    if (selected !== name) {
      setSelected(name);
      return;
    }
    if (province) {
      onSigungu?.(name, province);
    } else {
      const key = provinceKey(name);
      onRegion?.(name);
      if (key && drillOnRegionTap) setProvince(key);
    }
    setSelected(null);
  };

  const regions = useMemo(() => {
    const scale = boxW / vb.w;
    return map.paths
      .map((p) => {
        const b = dominantBox(p.d);
        if (!b) return null;
        return {
          name: p.name,
          left: (b.minX - vb.x) * scale,
          top: (b.minY - vb.y) * scale,
          width: Math.max((b.maxX - b.minX) * scale, 10),
          height: Math.max((b.maxY - b.minY) * scale, 10),
          area: b.area,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b as any).area - (a as any).area) as {
      name: string; left: number; top: number; width: number; height: number; area: number;
    }[];
  }, [map, boxW, vb]);

  const titleText = pressed || selected || province || '';

  return (
    <View onLayout={(e) => setMeasuredW(Math.floor(e.nativeEvent.layout.width))}>
      <View style={styles.bar}>
        {province && allowNational ? (
          <Pressable
            style={styles.backBtn}
            onPress={() => { setProvince(null); setSelected(null); }}
            hitSlop={8}
          >
            <Text style={styles.backText}>← 전국</Text>
          </Pressable>
        ) : teamRegion ? (
          <View style={styles.tag}>
            <View style={styles.dot} />
            <Text style={styles.tagText}>우리 팀 · {teamRegion}</Text>
          </View>
        ) : (
          <View />
        )}
        <Text style={styles.title}>{titleText}</Text>
      </View>

      <Animated.View key={province ?? 'nat'} entering={FadeIn.duration(220)} style={[styles.mapWrap, { height: svgH }]}>
        <View style={{ width: boxW, height: svgH }}>
          <Svg width={boxW} height={svgH} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} style={StyleSheet.absoluteFill}>
            {map.paths.map((p) => {
              const isTeam = province
                ? !!teamSigungu && p.name.startsWith(teamSigungu.slice(0, 2))
                : !!teamRegion && (p.name === teamRegion || p.name.startsWith(teamRegion.slice(0, 2)));
              const isPressed = pressed === p.name;
              const isSelected = selected === p.name;
              const fill = isPressed || isSelected
                ? MAP_COLORS.selected
                : isTeam
                ? province
                  ? MAP_COLORS.sigunguTeam
                  : MAP_COLORS.team
                : province
                ? MAP_COLORS.sigunguFill
                : MAP_COLORS.landFill;
              const stroke = province ? MAP_COLORS.sigunguStroke : MAP_COLORS.landStroke;
              return (
                <Path
                  key={p.name || p.d.slice(0, 12)}
                  d={p.d}
                  fill={fill}
                  stroke={isTeam ? MAP_COLORS.teamStroke : stroke}
                  strokeWidth={isTeam || isSelected ? 1.4 : 0.8}
                />
              );
            })}
          </Svg>

          {regions.map((r) => (
            <Pressable
              key={r.name || `${r.left},${r.top}`}
              style={{ position: 'absolute', left: r.left, top: r.top, width: r.width, height: r.height }}
              hitSlop={2}
              onPressIn={() => setPressed(r.name)}
              onPressOut={() => setPressed(null)}
              onPress={() => onLandPress(r.name)}
            />
          ))}
        </View>
      </Animated.View>


    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, minHeight: 28 },
  backBtn: { backgroundColor: colors.primaryDark, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5 },
  backText: { color: colors.parchment, fontSize: 12, fontWeight: '700', fontFamily: fonts.bodyB },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(212,160,23,0.14)', borderWidth: 1, borderColor: 'rgba(212,160,23,0.5)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.gold },
  tagText: { fontSize: 11, fontWeight: '700', color: '#8A6A1E', fontFamily: fonts.bodyB },
  title: { fontFamily: fonts.pixel, fontSize: 14, color: colors.primaryDark },
  mapWrap: { alignItems: 'center', justifyContent: 'center' },
  hint: { textAlign: 'center', fontSize: 11.5, color: colors.textSecondary, marginTop: 8, fontFamily: fonts.bodyM },
});