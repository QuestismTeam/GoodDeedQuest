import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { colors, fonts, radii, shadow } from '../../theme';
import HazeBackground from '../../components/HazeBackground';
import MainHeader from '../../components/MainHeader';
import { RankRow } from './_parts';
import KoreaMapDrilldown from '../../components/KoreaMapDrilldown';
import { resolveCityId } from './provinceCityIds';
import { getCityRanking, CityRankingEntry } from '../../api/map';

export default function SiDoMapScreen({ navigation, route }: any) {
  const province: string = route.params?.province ?? '';
  const teamRegion: string = route.params?.teamRegion ?? '경기도';
  const teamSigungu: string = route.params?.teamSigungu ?? '안양시';

  const [ranking, setRanking] = useState<CityRankingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cityId = resolveCityId(province);

    if (cityId === null) {
      setError(`"${province}"에 해당하는 city_id를 찾을 수 없습니다.`);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    getCityRanking(cityId)
      .then((data) => {
        if (!cancelled) setRanking(data.ranking);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message ?? '랭킹을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [province]);

  const maxScore = ranking.length > 0 ? Math.max(ranking[0].average_score, 1) : 1;

  const goToRegionDetails = (sigunguName: string, provinceName: string) => {
    const match = ranking.find((r) => r.region_name === sigunguName);
    navigation.navigate('RegionDetails', {
      region: provinceName,
      sigungu: sigunguName,
      regionId: match?.region_id,
    });
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <HazeBackground />
      <MainHeader showBack title={province} />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.mapCard}>
          <KoreaMapDrilldown
            teamRegion={teamRegion}
            teamSigungu={teamSigungu}
            initialProvince={province}
            allowNational={false}
            height={520}
            onSigungu={(sg, prov) => goToRegionDetails(sg, prov)}
          />
        </View>

        <Text style={styles.sectionTitle}>🏆 {province} 시군구별 랭킹 (1인당 평균)</Text>

        {loading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator color={colors.primaryDark} />
          </View>
        ) : error ? (
          <View style={styles.centerBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : ranking.length === 0 ? (
          <View style={styles.centerBox}>
            <Text style={styles.errorText}>아직 랭킹 데이터가 없어요.</Text>
          </View>
        ) : (
          <View style={styles.listCard}>
            {ranking.map((r, i) => (
              <RankRow
                key={r.region_id}
                index={i}
                name={r.region_name}
                score={r.average_score.toLocaleString()}
                subtitle={`${r.participant_count.toLocaleString()}명 참여`}
                pct={r.average_score / maxScore}
                onPress={() =>
                  navigation.navigate('RegionDetails', {
                    region: province,
                    sigungu: r.region_name,
                    regionId: r.region_id,
                  })
                }
              />
            ))}
          </View>
        )}
      </ScrollView>
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
    ...shadow.card,
  },
  centerBox: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontFamily: fonts.bodyR,
  },
});