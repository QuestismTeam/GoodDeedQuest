import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { colors, fonts, radii, shadow } from '../../theme';
import HazeBackground from '../../components/HazeBackground';
import MainHeader from '../../components/MainHeader';
import SpringButton from '../../components/SpringButton';
import { TeamSelectPopup, RankRow } from './_parts';
import KoreaMapDrilldown from '../../components/KoreaMapDrilldown';
import { resolveProvinceName } from './provinceCityIds';
import { useToast } from '../../components/Toast';
import { getNationalRanking, NationalRankingEntry, getMapMain, selectTeamRegion } from '../../api/map';

export default function MainMapScreen({ navigation, route }: any) {
  const toast = useToast();

  const [teamLoading, setTeamLoading] = useState(true);
  const [teamSet, setTeamSet] = useState(false);
  const [teamSubmitting, setTeamSubmitting] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [teamRegion, setTeamRegion] = useState('');
  const [teamSigungu, setTeamSigungu] = useState('');

  const [ranking, setRanking] = useState<NationalRankingEntry[]>([]);
  const [rankLoading, setRankLoading] = useState(true);
  const [rankError, setRankError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTeamLoading(true);
    getMapMain()
      .then((data) => {
        if (cancelled) return;
        if (data.has_region && data.region) {
          setTeamRegion(resolveProvinceName(data.region.city_id) ?? '');
          setTeamSigungu(data.region.region_name);
          setTeamSet(true);
        } else {
          setTeamRegion('');
          setTeamSigungu('');
          setTeamSet(false);
        }
      })
      .catch(() => {
        if (!cancelled) setTeamSet(false);
      })
      .finally(() => {
        if (!cancelled) setTeamLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setRankLoading(true);
    setRankError(null);
    getNationalRanking()
      .then((data) => {
        if (!cancelled) setRanking(data.ranking);
      })
      .catch((err) => {
        if (!cancelled) setRankError(err.message ?? '랭킹을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setRankLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const maxScore = ranking.length > 0 ? Math.max(ranking[0].total_score, 1) : 1;

  const goToProvince = (cityId: number, fallbackName: string) => {
    const svgName = resolveProvinceName(cityId) ?? fallbackName;
    navigation.navigate('SiDoMap', { province: svgName, teamRegion, teamSigungu });
  };

  const handleTeamConfirm = useCallback(async (regionId: number, sido: string, sigunguName: string) => {
    setTeamSubmitting(true);
    try {
      const result = await selectTeamRegion(regionId);
      setTeamRegion(sido);
      setTeamSigungu(result.region_name);
      setTeamSet(true);
      setPickOpen(false);
      toast.show('참여 지역이 설정되었어요.');
    } catch (err: any) {
      toast.show(err.message ?? '참여 지역을 설정하지 못했어요.');
    } finally {
      setTeamSubmitting(false);
    }
  }, [toast]);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <HazeBackground />
      <MainHeader />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <SpringButton style={styles.nearbyBtn} onPress={() => navigation.navigate('VolSearch')}>
          <Text style={styles.nearbyText}>내 주변 둘러보기</Text>
        </SpringButton>

        <View style={styles.mapCard}>
          <KoreaMapDrilldown
            teamRegion={teamRegion}
            teamSigungu={teamSigungu}
            height={560}
            drillOnRegionTap={false}
            onRegion={(name) => navigation.navigate('SiDoMap', { province: name, teamRegion, teamSigungu })}
          />
          {teamLoading ? null : teamSet ? (
            <Pressable style={styles.teamChangeBtn} onPress={() => setPickOpen(true)}>
              <Text style={styles.teamChangeText}>팀 변경하기</Text>
            </Pressable>
          ) : (
            <View style={styles.teamOverlay}>
              <Text style={styles.overlayHint}>대항전에 참여할 팀을 설정해 주세요</Text>
              <SpringButton style={styles.overlayBtn} onPress={() => setPickOpen(true)}>
                <Text style={styles.overlayBtnText}>대항전 참여팀 설정하기</Text>
              </SpringButton>
            </View>
          )}
        </View>

        <Text style={styles.sectionTitle}>🏆 시/도별 랭킹</Text>
        {rankLoading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator color={colors.primaryDark} />
          </View>
        ) : rankError ? (
          <View style={styles.centerBox}>
            <Text style={styles.errorText}>{rankError}</Text>
          </View>
        ) : ranking.length === 0 ? (
          <View style={styles.centerBox}>
            <Text style={styles.errorText}>아직 랭킹 데이터가 없어요.</Text>
          </View>
        ) : (
          <View style={styles.listCard}>
            {ranking.map((r, i) => (
              <RankRow
                key={r.city_id}
                index={i}
                name={r.city_name}
                score={r.total_score.toLocaleString()}
                pct={r.total_score / maxScore}
                onPress={() => goToProvince(r.city_id, r.city_name)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <TeamSelectPopup
        visible={pickOpen}
        onClose={() => setPickOpen(false)}
        region={teamRegion}
        city={teamSigungu}
        submitting={teamSubmitting}
        onConfirm={handleTeamConfirm}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  body: { padding: 16, paddingBottom: 32 },
  mapCard: {
    position: 'relative',
    borderWidth: 1.5,
    borderColor: colors.pixelBorder,
    borderRadius: radii.chip,
    backgroundColor: colors.white,
    marginBottom: 16,
    padding: 12,
  },
  teamChangeBtn: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    backgroundColor: colors.pixelBorder,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 8,
    ...shadow.card,
  },
  teamChangeText: { fontFamily: fonts.pixel, fontSize: 12, color: colors.parchment },
  teamOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(3,50,54,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 24,
  },
  overlayHint: { color: colors.parchment, fontSize: 14, fontFamily: fonts.bodyM, textAlign: 'center' },
  overlayBtn: {
    height: 48,
    borderRadius: radii.button,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  overlayBtnText: { fontFamily: fonts.pixel, fontSize: 15, color: colors.parchment },
  sectionTitle: {
    fontFamily: fonts.pixel,
    fontSize: 16,
    color: colors.primaryDark,
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 2,
    borderBottomColor: '#E6D9B8',
  },
  listCard: {
    backgroundColor: colors.white,
    borderRadius: radii.chip,
    overflow: 'hidden',
    marginBottom: 16,
    ...shadow.card,
  },
  centerBox: {
    paddingVertical: 32,
    alignItems: 'center',
    marginBottom: 16,
  },
  errorText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontFamily: fonts.bodyR,
  },
  nearbyBtn: {
    height: 52,
    borderRadius: 8,
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    ...shadow.button,
  },
  nearbyText: { fontFamily: fonts.pixel, fontSize: 18, color: colors.parchment },
});