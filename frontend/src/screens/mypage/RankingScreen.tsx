import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { colors, fonts } from '../../theme';
import HazeBackground from '../../components/HazeBackground';
import MainHeader from '../../components/MainHeader';
import SegmentedTabs from '../../components/SegmentedTabs';
import { getLeaderboard, LeaderboardEntry } from '../../api/growth';
import { getMapMain, getRegionRanking, PersonalRankingEntry } from '../../api/map';

export default function RankScreen({ navigation, route }: any) {
  const [mode, setMode] = useState(0);

  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [myEntry, setMyEntry] = useState<LeaderboardEntry | null>(null);
  const [nearbyRanks, setNearbyRanks] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [hasRegion, setHasRegion] = useState(true);
  const [regionName, setRegionName] = useState<string | null>(null);
  const [regionRanking, setRegionRanking] = useState<PersonalRankingEntry[]>([]);
  const [battleLoading, setBattleLoading] = useState(true);
  const [battleError, setBattleError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      setLoading(true);
      setError(null);
      getLeaderboard()
        .then((data) => {
          if (cancelled) return;
          setLeaderboard(data.leaderboard);
          setMyEntry(data.my_entry);
          setNearbyRanks(data.nearby_ranks);
        })
        .catch((err) => {
          if (!cancelled) setError(err.message ?? '랭킹을 불러오지 못했습니다.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });

      setBattleLoading(true);
      setBattleError(null);
      getMapMain()
        .then((main) => {
          if (cancelled) return null;
          if (!main.has_region || !main.region) {
            setHasRegion(false);
            setRegionRanking([]);
            return null;
          }
          setHasRegion(true);
          setRegionName(main.region.region_name);
          return getRegionRanking(main.region.region_id);
        })
        .then((rr) => {
          if (cancelled || !rr) return;
          setRegionRanking(rr.personal_ranking);
        })
        .catch((err) => {
          if (!cancelled) setBattleError(err.message ?? '지역 랭킹을 불러오지 못했습니다.');
        })
        .finally(() => {
          if (!cancelled) setBattleLoading(false);
        });

      return () => {
        cancelled = true;
      };
    }, [])
  );

  const myInTop = leaderboard.some((e) => e.is_me);
  const regionTop = regionRanking.slice(0, 10);
  const regionMyEntry = regionRanking.find((r) => r.is_me) ?? null;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <HazeBackground />
      <MainHeader showBack title="개인 레벨 랭킹" />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.tabs}>
          <SegmentedTabs tabs={['레벨', '랭킹전']} index={mode} onChange={setMode} />
        </View>

        {mode === 0 ? (
          loading ? (
            <View style={styles.centerBox}>
              <ActivityIndicator color={colors.primaryDark} />
            </View>
          ) : error ? (
            <View style={styles.centerBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : (
            <>
              <View style={styles.table}>
                <View style={styles.thead}>
                  <Text style={[styles.thRank, styles.theadText]}>순위</Text>
                  <Text style={[styles.thName, styles.theadText]}>닉네임</Text>
                  <Text style={styles.theadText}>레벨</Text>
                </View>
                {leaderboard.map((r, i) => (
                  <Animated.View
                    key={r.user_id}
                    entering={FadeInDown.delay(40 + i * 60).duration(400)}
                    style={[styles.row, r.is_me && styles.rowMe, i === leaderboard.length - 1 && styles.rowLast]}
                  >
                    <Text style={styles.rowRank}>{r.rank}위</Text>
                    <Text style={styles.rowName}>{r.nickname}{r.is_me ? ' (나)' : ''}</Text>
                    <Text style={styles.rowVal}>{r.current_level}lv</Text>
                  </Animated.View>
                ))}
              </View>

              {!myInTop && nearbyRanks.length > 0 && (
                <>
                  <Text style={styles.gapHint}>· · ·</Text>
                  <View style={styles.table}>
                    {nearbyRanks.map((r, i) => (
                      <View
                        key={r.user_id}
                        style={[styles.row, r.is_me && styles.rowMe, i === nearbyRanks.length - 1 && styles.rowLast]}
                      >
                        <Text style={styles.rowRank}>{r.rank}위</Text>
                        <Text style={styles.rowName}>{r.nickname}{r.is_me ? ' (나)' : ''}</Text>
                        <Text style={styles.rowVal}>{r.current_level}lv</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </>
          )
        ) : battleLoading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator color={colors.primaryDark} />
          </View>
        ) : battleError ? (
          <View style={styles.centerBox}>
            <Text style={styles.errorText}>{battleError}</Text>
          </View>
        ) : !hasRegion ? (
          <View style={styles.centerBox}>
            <Text style={styles.errorText}>참여 지역을 먼저 설정해 주세요.</Text>
          </View>
        ) : (
          <>
            {regionName ? <Text style={styles.regionHeader}>{regionName} 동네대항전 개인 기여</Text> : null}
            <View style={styles.table}>
              <View style={styles.thead}>
                <Text style={[styles.thRank, styles.theadText]}>순위</Text>
                <Text style={[styles.thName, styles.theadText]}>닉네임</Text>
                <Text style={styles.theadText}>점수</Text>
              </View>
              {regionTop.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Text style={styles.errorText}>아직 이 지역의 기여 기록이 없어요.</Text>
                </View>
              ) : (
                regionTop.map((r, i) => (
                  <Animated.View
                    key={r.user_id}
                    entering={FadeInDown.delay(40 + i * 60).duration(400)}
                    style={[styles.row, r.is_me && styles.rowMe, i === regionTop.length - 1 && styles.rowLast]}
                  >
                    <Text style={styles.rowRank}>{r.rank}위</Text>
                    <Text style={styles.rowName}>{r.nickname}{r.is_me ? ' (나)' : ''}</Text>
                    <Text style={styles.rowVal}>{r.score.toLocaleString()}점</Text>
                  </Animated.View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>

      {mode === 0 && myEntry ? (
        <LinearGradient
          colors={['rgba(238,246,240,0)', colors.screenBg]}
          locations={[0, 0.4]}
          style={styles.stickyWrap}
        >
          <View style={styles.myRow}>
            <Text style={styles.myRank}>{myEntry.rank}위</Text>
            <Text style={styles.myName}>{myEntry.nickname} (나)</Text>
            <Text style={styles.myVal}>{myEntry.current_level}lv</Text>
          </View>
        </LinearGradient>
      ) : mode === 1 && regionMyEntry ? (
        <LinearGradient
          colors={['rgba(238,246,240,0)', colors.screenBg]}
          locations={[0, 0.4]}
          style={styles.stickyWrap}
        >
          <View style={styles.myRow}>
            <Text style={styles.myRank}>{regionMyEntry.rank}위</Text>
            <Text style={styles.myName}>{regionMyEntry.nickname} (나)</Text>
            <Text style={styles.myVal}>{regionMyEntry.score.toLocaleString()}점</Text>
          </View>
        </LinearGradient>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  scroll: { flex: 1 },
  body: { padding: 16, paddingBottom: 96 },

  tabs: { marginBottom: 14 },

  centerBox: { paddingVertical: 40, alignItems: 'center' },
  emptyBox: { paddingVertical: 20, alignItems: 'center', backgroundColor: colors.white },
  errorText: { fontSize: 13, color: colors.textSecondary, fontFamily: fonts.bodyR },
  gapHint: { textAlign: 'center', color: '#AAA', fontSize: 12, marginVertical: 8, fontFamily: fonts.bodyR },
  regionHeader: { fontFamily: fonts.pixel, fontSize: 13, color: colors.primaryDark, marginBottom: 8 },

  table: {
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#033236',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  thead: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryDark,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  theadText: { fontFamily: fonts.pixel, fontSize: 14, color: colors.white },
  thRank: { width: 56 },
  thName: { flex: 1 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF1F0',
  },
  rowMe: {
    backgroundColor: colors.parchment,
    borderLeftWidth: 4,
    borderLeftColor: colors.gold,
  },
  rowLast: { borderBottomWidth: 0 },
  rowRank: { width: 56, fontFamily: fonts.pixel, fontSize: 14, color: colors.primaryDark },
  rowName: { flex: 1, fontSize: 14, color: colors.textPrimary, fontFamily: fonts.bodyR },
  rowVal: { fontSize: 14, fontWeight: '700', color: colors.xpGreen, fontFamily: fonts.bodyB },

  stickyWrap: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
  },
  myRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.parchment,
    borderWidth: 2,
    borderColor: colors.gold,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 14,
    elevation: 3,
  },
  myRank: { width: 56, fontFamily: fonts.pixel, fontSize: 14, color: colors.gold },
  myName: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.primaryDark, fontFamily: fonts.bodyB },
  myVal: { fontSize: 14, fontWeight: '700', color: colors.xpGreen, fontFamily: fonts.bodyB },
});