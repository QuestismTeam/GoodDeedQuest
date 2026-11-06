/**
 * SCREEN 7 · AI 커스텀 추천 (route AiRecommend, back) — 챗봇 메시지 버블 + 타이핑
 * 인디케이터(3-dot wave). 요청을 보내면 추천 그래프를 돌리고, 완료되면
 * "퀘스트 목록 보러가기" 버튼으로 홈에 돌아가 새 추천 5개를 확인한다.
 */
import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform, ActivityIndicator} from 'react-native';
import type { ScrollViewInstance } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { colors, fonts } from '../../theme';
import HazeBackground from '../../components/HazeBackground';
import MainHeader from '../../components/MainHeader';
import SpringButton from '../../components/SpringButton';
import { BotAvatar, ChevRight } from './_parts';
import { refreshRecommendation } from '../../api/quest';
import { getCurrentCoords } from '../../utils/location';

type Msg = { who: 'bot' | 'user' | 'reco'; text: string };

// 화면에 들어올 때마다 새로 만들어지므로 매번 이 안내부터 시작한다.
const INITIAL: Msg[] = [
  { who: 'bot', text: '원하는 요청을 입력하시면 맞춤 선행을 추천해 드립니다.' },
];

export default function AiRecommendScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const [msgs, setMsgs] = useState<Msg[]>(INITIAL);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef<ScrollViewInstance>(null);

  const scrollDown = () => requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));

  const send = async () => {
    const v = input.trim();
    if (!v) return;
    // 한 번에 20~30초가 걸린다. 그 사이에 또 보내면 파이프라인이 겹쳐 돌고
    // 퀘스트가 5개씩 두 벌 저장된다.
    if (typing) return;

    setInput('');
    setMsgs((m) => [...m, { who: 'user', text: v }]);
    setTyping(true);
    scrollDown();

    try {
      const coords = await getCurrentCoords();
      const quests = await refreshRecommendation(coords?.latitude, coords?.longitude, v);
      setTyping(false);
      setMsgs((m) => [...m, { who: 'reco', text: `요청에 맞는 선행 ${quests.length}개를 찾았어요.` }]);
    } catch (err: any) {
      setTyping(false);
      setMsgs((m) => [...m, { who: 'bot', text: '추천을 만들지 못했어요. 잠시 후 다시 시도해 주세요.' }]);
    }
    scrollDown();
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <HazeBackground />
      <MainHeader showBack title="AI 커스텀 추천" onBack={() => navigation.goBack()} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.chat}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={scrollDown}
        >
          {msgs.map((m, i) => (
            <Animated.View key={i} entering={FadeInDown.duration(360)}>
              {m.who === 'user' ? (
                <View style={styles.userRow}>
                  <View style={styles.userBubble}>
                    <Text style={styles.userText}>{m.text}</Text>
                  </View>
                </View>
              ) : (
                <View style={styles.botRow}>
                  <BotAvatar />
                  <View style={styles.botBubble}>
                    <Text style={styles.botText}>{m.text}</Text>
                    {m.who === 'reco' ? (
                      <Pressable onPress={() => navigation.navigate('QuestHome')} style={styles.detailChip}>
                        <Text style={styles.detailChipText}>퀘스트 목록 보러가기</Text>
                        <ChevRight size={16} color="#033236" />
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              )}
            </Animated.View>
          ))}
          {/* 추천 생성은 20~30초가 걸린다. 점 세 개만으로는 얼마나 기다려야 하는지
              알 수 없어, 홈 화면과 같은 안내를 말풍선 안에 넣는다. */}
          {typing ? (
            <View style={styles.botRow}>
              <BotAvatar />
              <View style={[styles.botBubble, styles.loadingBubble]}>
                <ActivityIndicator color={colors.primaryDark} />
                <Text style={styles.botText}>AI가 맞춤 선행을 찾고 있어요</Text>
                <Text style={styles.loadingHint}>최대 1분 정도 걸릴 수 있어요</Text>
              </View>
            </View>
          ) : null}
        </ScrollView>

        <View style={[styles.inputBar, { paddingBottom: insets.bottom + 14 }]}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="원하는 선행을 요청해 보세요"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            returnKeyType="send"
            onSubmitEditing={send}
          />
          <SpringButton
            onPress={send}
            disabled={!input.trim() || typing}
            style={[styles.sendBtn, { opacity: input.trim() && !typing ? 1 : 0.5 }]}
          >
            <Text style={styles.sendText}>전송</Text>
          </SpringButton>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  chat: { padding: 16, gap: 16, paddingBottom: 24 },

  userRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  userBubble: {
    maxWidth: '78%',
    backgroundColor: colors.primaryDark,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
    borderBottomLeftRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  userText: { color: colors.white, fontSize: 14, lineHeight: 21, fontFamily: fonts.bodyR },

  botRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  botBubble: {
    maxWidth: '78%',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#EDF1EF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  botText: { fontSize: 14, color: colors.textPrimary, lineHeight: 21, fontFamily: fonts.bodyR },
  loadingBubble: { alignItems: 'center', gap: 8 },
  loadingHint: { fontSize: 11, color: colors.textMuted, lineHeight: 16, fontFamily: fonts.bodyR },
  detailChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: 10,
    backgroundColor: colors.screenBg,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  detailChipText: { fontSize: 12, fontWeight: '700', color: colors.primaryDark, fontFamily: fonts.bodyB },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 14,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: '#EDF1EF',
  },
  input: {
    flex: 1,
    height: 44,
    backgroundColor: '#F6F6F6',
    borderRadius: 22,
    paddingHorizontal: 16,
    fontSize: 14,
    color: colors.textPrimary,
    fontFamily: fonts.bodyR,
  },
  sendBtn: { height: 44, paddingHorizontal: 18, borderRadius: 22, backgroundColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: colors.white, fontSize: 14, fontWeight: '700', fontFamily: fonts.bodyB },
});
