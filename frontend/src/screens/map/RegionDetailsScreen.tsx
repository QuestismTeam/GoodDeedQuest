import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { colors, fonts, radii, shadow } from '../../theme';
import HazeBackground from '../../components/HazeBackground';
import MainHeader from '../../components/MainHeader';
import { UserRankRow, TeamSelectPopup } from './_parts';
import { useToast } from '../../components/Toast';
import { getRegionRanking, PersonalRankingEntry, RecommendedFacility, selectTeamRegion } from '../../api/map';

function rankLabel(index: number): string {
  if (index === 0) return 'MVP';
  if (index === 1) return '2등';
  if (index === 2) return '3등';
  return `${index + 1}등`;
}

export default function RegionDetailsScreen({ navigation, route }: any) {
  const region: string = route?.params?.region ?? '경기도';
  const sigungu: string = route?.params?.sigungu ?? '';
  const regionId: number | undefined = route?.params?.regionId;

  const toast = useToast();

  const [pickOpen, setPickOpen] = useState(false);
  const [teamSubmitting, setTeamSubmitting] = useState(false);
  const [regionName, setRegionName] = useState(sigungu);
  const [personalRanking, setPersonalRanking] = useState<PersonalRankingEntry[]>([]);
  const [lackingCategory, setLackingCategory] = useState('');
  const [lackingComment, setLackingComment] = useState('');
  const [facilities, setFacilities] = useState<RecommendedFacility[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (regionId === undefined) {
      setError('지역 정보를 찾을 수 없습니다. 시군구 랭킹 목록에서 다시 눌러주세요.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    getRegionRanking(regionId)
      .then((data) => {
        if (cancelled) return;
        setRegionName(data.region_name);
        setPersonalRanking(data.personal_ranking);
        setLackingCategory(data.lacking_category);
        setLackingComment(data.lacking_category_comment);
        setFacilities(data.recommended_facilities);
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
  }, [regionId]);

  const handleTeamConfirm = async (newRegionId: number, _sido: string, sigunguName: string) => {
    setTeamSubmitting(true);
    try {
      await selectTeamRegion(newRegionId);
      setPickOpen(false);
      toast.show(`참여 지역이 ${sigunguName}(으)로 설정되었어요.`);
    } catch (err: any) {
      toast.show(err.message ?? '참여 지역을 설정하지 못했어요.');
    } finally {
      setTeamSubmitting(false);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <HazeBackground />
      <MainHeader
        showBack
        title={regionName || region}
        right={
          <Pressable hitSlop={8} onPress={() => setPickOpen(true)}>
            <Text style={styles.headerAction}>팀 변경</Text>
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
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
            <Text style={styles.cityTitle}>{regionName} 개인 랭킹</Text>

            <View style={styles.userCard}>
              <View style={styles.userHead}>
                <Text style={[styles.userHeadTxt, { width: 56 }]}>순위</Text>
                <Text style={[styles.userHeadTxt, { flex: 1 }]}>닉네임</Text>
                <Text style={styles.userHeadTxt}>획득 XP</Text>
              </View>
              {personalRanking.length === 0 ? (
                <Text style={styles.emptyText}>아직 이 지역의 기여 기록이 없어요.</Text>
              ) : (
                personalRanking.slice(0, 10).map((u, i) => (
                  <UserRankRow
                    key={u.user_id}
                    index={i}
                    rank={rankLabel(i)}
                    name={u.nickname}
                    xp={u.score.toLocaleString()}
                    onPress={() =>
                      navigation.navigate('UserDetail', {
                        user: { name: u.nickname, info: `${rankLabel(i)} · ${u.score.toLocaleString()} XP` },
                      })
                    }
                  />
                ))
              )}
            </View>

            <View style={styles.aiBox}>
              <Text style={styles.aiTitle}>🤖 지역 부족봉사 AI 판단</Text>
              <Text style={styles.aiText}>
                {regionName}는 현재 <Text style={styles.aiBold}>{lackingCategory}</Text> 봉사 분야 인력이 부족합니다.{'\n'}
                {lackingComment}
              </Text>
            </View>

            <Text style={styles.recTitle}>📌 추천 봉사시설</Text>
            {facilities.length === 0 ? (
              <Text style={styles.emptyText}>추천할 시설이 아직 없어요.</Text>
            ) : (
              <View style={{ gap: 10 }}>
                {facilities.map((f, i) => (
                  <Animated.View key={f.center_id} entering={FadeInDown.delay(100 + i * 90).duration(420)}>
                    <Pressable
                      style={({ pressed }) => [styles.facCard, pressed && styles.facPressed]}
                      onPress={() =>
                        navigation.navigate('VolunteerDetail', {
                          item: { name: f.vol_name, sub: `${f.region_name} · ${f.ai_category}`, centerId: f.center_id },
                        })
                      }
                    >
                      <Text style={styles.facName}>{f.vol_name}</Text>
                      <Text style={styles.facSub}>{f.region_name} · {f.ai_category}</Text>
                    </Pressable>
                  </Animated.View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      <TeamSelectPopup
        visible={pickOpen}
        onClose={() => setPickOpen(false)}
        onConfirm={handleTeamConfirm}
        submitting={teamSubmitting}
        region={region}
        city={regionName}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  headerAction: { fontFamily: fonts.bodyB, fontSize: 13, color: colors.gold },
  body: { padding: 16, paddingBottom: 32 },
  centerBox: { paddingVertical: 40, alignItems: 'center' },
  errorText: { fontSize: 13, color: colors.textSecondary, fontFamily: fonts.bodyR, textAlign: 'center' },
  emptyText: { fontSize: 13, color: colors.textSecondary, fontFamily: fonts.bodyR, paddingVertical: 12 },
  cityTitle: { textAlign: 'center', fontFamily: fonts.pixel, fontSize: 22, color: colors.primaryDark, marginBottom: 16 },
  userCard: {
    backgroundColor: colors.parchment,
    borderWidth: 1.5,
    borderColor: colors.pixelBorder,
    borderRadius: radii.chip,
    padding: 16,
    marginBottom: 16,
  },
  userHead: { flexDirection: 'row', paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#E6D9B8' },
  userHeadTxt: { fontFamily: fonts.pixel, fontSize: 13, color: '#888' },
  aiBox: {
    backgroundColor: colors.screenBg,
    borderLeftWidth: 4,
    borderLeftColor: colors.gold,
    borderRadius: 8,
    padding: 14,
    marginBottom: 18,
  },
  aiTitle: { fontFamily: fonts.pixel, fontSize: 15, color: colors.primaryDark, marginBottom: 8 },
  aiText: { fontSize: 13, color: '#555', lineHeight: 21, fontFamily: fonts.bodyR },
  aiBold: { color: colors.primaryDark, fontFamily: fonts.bodyB },
  recTitle: { fontFamily: fonts.pixel, fontSize: 16, color: colors.primaryDark, marginBottom: 12 },
  facCard: {
    backgroundColor: colors.white,
    borderLeftWidth: 3,
    borderLeftColor: colors.xpGreen,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 13,
    ...shadow.card,
  },
  facPressed: { backgroundColor: '#F4F9F5' },
  facName: { fontWeight: '700', fontSize: 14, color: colors.primaryDark, marginBottom: 3, fontFamily: fonts.bodyB },
  facSub: { fontSize: 12, color: '#888', fontFamily: fonts.bodyR },
});