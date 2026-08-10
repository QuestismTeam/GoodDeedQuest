import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Linking, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Line } from 'react-native-svg';
import { colors, fonts, radii, shadow } from '../../theme';
import HazeBackground from '../../components/HazeBackground';
import MainHeader from '../../components/MainHeader';
import { useToast } from '../../components/Toast';
import KakaoMapView from '../../components/KakaoMapView';
import { MapPinIcon, MAP } from './_parts';
import { getOrCreateQuestFromVolunteerCenter, startQuest } from '../../api/quest';
import { getVolunteerCenter } from '../../api/map';

function DetailGrid() {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox="0 0 300 180" preserveAspectRatio="none">
      {Array.from({ length: 10 }).map((_, i) => (
        <Line key={`v${i}`} x1={i * 34} y1={0} x2={i * 34} y2={180} stroke={MAP.grid} strokeWidth={0.6} />
      ))}
      {Array.from({ length: 6 }).map((_, i) => (
        <Line key={`h${i}`} x1={0} y1={i * 34} x2={300} y2={i * 34} stroke={MAP.grid} strokeWidth={0.6} />
      ))}
    </Svg>
  );
}

type RawItem = {
  center_id?: number;
  vol_name?: string | null;
  vol_title?: string | null;
  vol_address?: string | null;
  target?: string | null;
  vol_qual?: string | null;
  vol_act?: string | null;
  vol_date?: string | null;
  vms_url?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  name?: string;
  sub?: string;
  centerId?: number;
};

const FALLBACK = '정보 없음';
const LOADING_LABEL = '불러오는 중...';

function formatQual(text: string | null | undefined): string {
  if (!text) return FALLBACK;
  return text
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n');
}

function isSkeletonItem(it: RawItem): boolean {
  return it.center_id === undefined && it.centerId !== undefined;
}

export default function VolunteerDetailScreen({ navigation, route }: any) {
  const toast = useToast();
  const paramItems: RawItem[] | undefined = route?.params?.items;
  const singleItem: RawItem | undefined = route?.params?.item;
  const initialItems: RawItem[] = paramItems && paramItems.length > 0 ? paramItems : singleItem ? [singleItem] : [];

  const [items, setItems] = useState<RawItem[]>(initialItems);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    const targets = items
      .map((it, idx) => ({ it, idx }))
      .filter(({ it }) => isSkeletonItem(it));

    if (targets.length === 0) return;

    let cancelled = false;
    setLoadingDetail(true);

    Promise.all(
      targets.map(({ it, idx }) =>
        getVolunteerCenter(it.centerId as number)
          .then((full) => ({ idx, full }))
          .catch(() => null),
      ),
    )
      .then((results) => {
        if (cancelled) return;
        setItems((prev) => {
          const next = [...prev];
          results.forEach((r) => {
            if (r) next[r.idx] = { ...next[r.idx], ...r.full };
          });
          return next;
        });
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const place: string = route?.params?.place ?? items[0]?.vol_name ?? items[0]?.name ?? '이름 미상';
  const address: string | null = route?.params?.address ?? items[0]?.vol_address ?? items[0]?.sub ?? null;
  const latitude: number | null = route?.params?.latitude ?? items[0]?.latitude ?? null;
  const longitude: number | null = route?.params?.longitude ?? items[0]?.longitude ?? null;

  const [startingCenterId, setStartingCenterId] = useState<number | null>(null);

  const handleApply = (vmsUrl?: string | null) => {
    if (!vmsUrl) {
      toast.show('연결된 신청 페이지가 없어요.');
      return;
    }
    Linking.openURL(vmsUrl).catch(() => toast.show('신청 페이지를 여는 데 실패했어요.'));
  };

  const handleStartQuest = async (centerId?: number) => {
    if (!centerId || startingCenterId != null) return;
    setStartingCenterId(centerId);
    try {
      const quest = await getOrCreateQuestFromVolunteerCenter(centerId);
      await startQuest(quest.quest_id);
      navigation.navigate('QuestDetail', {
        questId: quest.quest_id,
        volunteerCenterId: quest.volunteer_center_id,
        questType: quest.quest_type,
        title: quest.quest_title,
        category: quest.category_code,
        desc: quest.quest_description,
        point: quest.reward_point ?? 0,
        exp: quest.reward_exp ?? 0,
        active: true,
      });
    } catch (err) {
      toast.show('퀘스트를 시작하지 못했어요.');
    } finally {
      setStartingCenterId(null);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <HazeBackground />
      <MainHeader showBack title="봉사활동 상세" />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.mapBox}>
          {latitude != null && longitude != null ? (
            <KakaoMapView
              latitude={latitude}
              longitude={longitude}
              radiusKm={0}
              level={4}
              markers={[{ id: 'detail-pin', lat: latitude, lng: longitude }]}
            />
          ) : (
            <>
              <LinearGradient colors={[MAP.canvasA, MAP.canvasB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
              <DetailGrid />
              <View style={styles.pinCenter}>
                {loadingDetail ? <ActivityIndicator color={colors.primaryDark} /> : <MapPinIcon size={40} />}
              </View>
            </>
          )}
        </View>

        <Text style={styles.place}>{place}</Text>
        {address ? <Text style={styles.address}>{address}</Text> : null}

        {items.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>표시할 봉사 정보가 없어요.</Text>
          </View>
        ) : (
          items.map((it, i) => {
            const centerId = it.center_id ?? it.centerId;
            const starting = startingCenterId === centerId;
            const pending = loadingDetail && isSkeletonItem(it);
            const fallback = pending ? LOADING_LABEL : FALLBACK;
            const rows = [
              { label: '활동기간', value: it.vol_date ?? fallback },
              { label: '봉사장소', value: it.vol_address ?? it.sub ?? address ?? fallback },
              { label: '봉사대상', value: it.target ?? fallback },
              { label: '자격요건', value: pending ? fallback : formatQual(it.vol_qual) },
              { label: '활동설명', value: it.vol_act ?? fallback },
            ];
            return (
              <View key={centerId ?? i} style={styles.card}>
                {items.length > 1 ? (
                  <Text style={styles.cardTitle}>{it.vol_title ? it.vol_title : `모집 ${i + 1}`}</Text>
                ) : it.vol_title ? (
                  <Text style={styles.cardTitle}>{it.vol_title}</Text>
                ) : null}
                {rows.map((r, ri) => (
                  <View key={r.label} style={[styles.row, ri === rows.length - 1 && { borderBottomWidth: 0 }]}>
                    <Text style={styles.label}>{r.label}</Text>
                    <Text style={styles.value}>{r.value}</Text>
                  </View>
                ))}
                <View style={styles.btnRow}>
                  <Pressable
                    onPress={() => handleApply(it.vms_url)}
                    style={({ pressed }) => [styles.applyBtn, styles.btnHalf, pressed && { transform: [{ scale: 0.97 }] }]}
                  >
                    <Text style={styles.applyText}>{pending ? LOADING_LABEL : it.vms_url ? '신청하기' : '신청 페이지 없음'}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleStartQuest(centerId)}
                    disabled={!centerId || starting}
                    style={({ pressed }) => [
                      styles.startBtn, styles.btnHalf,
                      (!centerId || starting) && { opacity: 0.6 },
                      pressed && { transform: [{ scale: 0.97 }] },
                    ]}
                  >
                    {starting ? (
                      <ActivityIndicator color={colors.parchment} size="small" />
                    ) : (
                      <Text style={styles.startText}>퀘스트 시작</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  body: { padding: 16, paddingBottom: 32 },
  mapBox: {
    height: 180,
    borderRadius: radii.chip,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: colors.pixelBorder,
    marginBottom: 16,
  },
  pinCenter: { position: 'absolute', left: '50%', top: '44%', marginLeft: -20, marginTop: -20 },
  place: { fontFamily: fonts.pixel, fontSize: 17, color: colors.primaryDark, marginBottom: 4 },
  address: { fontSize: 13, color: colors.textSecondary, fontFamily: fonts.bodyR, marginBottom: 16 },
  emptyBox: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { fontSize: 14, color: colors.textMuted, fontFamily: fonts.bodyR },
  card: {
    backgroundColor: colors.parchment,
    borderWidth: 1.5,
    borderColor: colors.pixelBorder,
    borderRadius: radii.chip,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    marginBottom: 14,
    ...shadow.card,
  },
  cardTitle: { fontFamily: fonts.pixel, fontSize: 14, color: colors.gold, marginBottom: 6 },
  row: { flexDirection: 'row', gap: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#EFE6CC' },
  label: { width: 64, fontFamily: fonts.pixel, fontSize: 13, color: colors.gold },
  value: { flex: 1, fontSize: 14, color: colors.primaryDark, lineHeight: 21, fontFamily: fonts.bodyR },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  btnHalf: { flex: 1 },
  applyBtn: {
    height: 46,
    borderRadius: 8,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyText: { fontFamily: fonts.pixel, fontSize: 14, color: colors.primaryDark },
  startBtn: {
    height: 46,
    borderRadius: 8,
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startText: { fontFamily: fonts.pixel, fontSize: 14, color: colors.parchment },
});