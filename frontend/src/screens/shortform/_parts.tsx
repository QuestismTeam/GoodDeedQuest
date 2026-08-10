/**
 * Shortform flow (08) — screen-local building blocks shared by the 3 screens.
 * Icons the shared PixelIcons set doesn't cover (music note, play/pause triangles),
 * the render spinner, the AI-script GamePopup, and the dark music BottomSheet.
 * Motion = Reanimated (transform/opacity + progress-bar fill, matching PixelProgress).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'; // ⭐ 수정: useMemo 추가
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEvent } from 'expo';
import { colors, fonts } from '../../theme';
import GamePopup from '../../components/GamePopup';
import BottomSheet from '../../components/BottomSheet';
import SpringButton from '../../components/SpringButton';
import { useToast } from '../../components/Toast';
import {
  generateScript,
  updateScript,
  getBackgroundMusicList,
  CaptionItem,
  ScriptGenerateResult,
  BackgroundMusic,
} from '../../api/shortform';

/* ----------------------------------------------------------------- palette */
// Dark music-sheet surface (design linear-gradient #0C4249→#052024, approximated solid).
export const sf = {
  sheetBg: '#073A40',
  cream: '#F5ECCB',
  scriptText: '#DCE7DB',
  trackSub: '#8FA79A',
  goldSoft: 'rgba(212,160,23,0.35)',
  goldLine: 'rgba(212,160,23,0.2)',
  glassFill: 'rgba(255,255,255,0.07)',
  chipInactive: 'rgba(255,255,255,0.08)',
  greenTint: 'rgba(76,175,80,0.12)',
} as const;

/* ------------------------------------------------------------------- icons */
export const MusicNoteIcon = ({ size = 30, color = colors.gold }: { size?: number; color?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M9 18V5l10-2v13" />
    <Circle cx={6} cy={18} r={3} />
    <Circle cx={16} cy={16} r={3} />
  </Svg>
);

export const PlayTri = ({ size = 14, color = sf.cream }: { size?: number; color?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <Path d="M8 5v14l11-7z" />
  </Svg>
);

export const PauseBars = ({ size = 14, color = sf.cream }: { size?: number; color?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <Path d="M7 5h3v14H7zM14 5h3v14h-3z" />
  </Svg>
);

/* --------------------------------------------------------- render spinner */
// Generating screen: 56×56 ring, top-arc teal, rotating (design sf-spin .8s linear).
export function Spinner() {
  const spin = useSharedValue(0);
  useEffect(() => {
    spin.value = withRepeat(withTiming(1, { duration: 800, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(spin);
  }, []);
  const st = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));
  return <Animated.View style={[spStyles.ring, st]} />;
}

const spStyles = StyleSheet.create({
  ring: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 5,
    borderColor: '#E7EFE8',
    borderTopColor: colors.primaryDark,
  },
});

// ⭐ 수정: 생성중 화면 — 폴링 틱(실제 상태 조회 주기)마다 한 단계씩 채워지는 진행 바.
// 백엔드가 세부 단계(%)를 내려주지 않으므로 실제 진행률은 아니지만, 폴링이 돌 때마다
// (=실제로 서버에 진행 상황을 물어볼 때마다) 조금씩 채워져서 "멈춰있지 않다"는 걸 보여준다.
const PROGRESS_TRACK_WIDTH = 220;

export function GeneratingProgressBar({ progress }: { progress: number }) {
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withTiming(progress, { duration: 700, easing: Easing.out(Easing.cubic) });
  }, [progress]);
  const st = useAnimatedStyle(() => ({ width: w.value * PROGRESS_TRACK_WIDTH }));
  return (
    <View style={pbStyles.track}>
      <Animated.View style={[pbStyles.fill, st]} />
    </View>
  );
}

const pbStyles = StyleSheet.create({
  track: {
    width: PROGRESS_TRACK_WIDTH,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E7EFE8',
    overflow: 'hidden',
    marginTop: 18,
  },
  fill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: colors.primaryDark,
  },
});

// ⭐ 추가: AI 대본 생성은 백엔드가 Vision → RAG → LLM Story 체인을 한 번의 동기 호출로
// 처리해서(#194 SCRIPT_TIMEOUT 참고) 실제 진행률(%)을 서버가 내려주지 않는다. 그래서
// 얼마나 걸릴지 전혀 알려주지 않는 Shimmer(빈 텍스트박스처럼 보이는 스켈레톤) 대신,
// 경과 시간 기반으로 "지금 어느 단계쯤일지"를 추정해 보여준다 - 실제 %는 아니지만
// 화면이 멈춘 게 아니라는 것과 대략 얼마나 더 기다려야 하는지 감을 준다.
const SCRIPT_GENERATE_STAGES = [
  { atSeconds: 0, label: 'AI가 사진 속 장면을 분석하고 있어요' },
  { atSeconds: 6, label: 'AI가 비슷한 선행 사례를 찾고 있어요' },
  { atSeconds: 14, label: 'AI가 대본을 작성하고 있어요' },
  { atSeconds: 30, label: '생각보다 오래 걸리고 있어요, 조금만 더 기다려주세요' },
] as const;

function ScriptGeneratingStatus() {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 200);
    return () => clearInterval(id);
  }, []);

  const elapsedSeconds = elapsedMs / 1000;
  const stage = SCRIPT_GENERATE_STAGES.reduce(
    (acc, s) => (elapsedSeconds >= s.atSeconds ? s : acc),
    SCRIPT_GENERATE_STAGES[0],
  );
  // 실제 진행률이 아니라 경과 시간을 0~92%로 점근시키는 연출용 진행바 - 20초 근처에서
  // 체감상 많이 찼다가 그 뒤로는 느리게 늘어나며 절대 100%를 찍지 않고 기다린다.
  const progress = Math.min(0.92, 1 - Math.exp(-elapsedSeconds / 20));

  return (
    <View style={ai.progressWrap}>
      <View style={ai.progressTrack}>
        <View style={[ai.progressFill, { width: `${progress * 100}%` }]} />
      </View>
      <Text style={ai.progressLabel}>{stage.label}</Text>
      <Text style={ai.progressElapsed}>약 {Math.floor(elapsedSeconds)}초 경과</Text>
    </View>
  );
}

/* ----------------------------------------------------- AI 대본 popup (dark) */
// captions(항목별 자막 배열) <-> 편집용 단일 textarea 사이 변환.
// 줄 수가 안 맞아도 원본 CaptionItem의 media_s3_key/order는 그대로 유지하고 caption 텍스트만 갈아끼운다.
function captionsToText(captions: CaptionItem[]): string {
  return captions
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((c) => c.caption)
    .join('\n');
}
function textToCaptions(text: string, original: CaptionItem[]): CaptionItem[] {
  const lines = text.split('\n');
  return original.map((c, i) => ({ ...c, caption: (lines[i] ?? c.caption).slice(0, 200) }));
}

export function AiScriptPopup({
  visible,
  onClose,
  shortsId,
  mediaKeys,
  questTitleResolver,
  onConfirmed,
  savedCaptions,
  savedTitle,
}: {
  visible: boolean;
  onClose: () => void;
  shortsId: number | null;
  mediaKeys: string[];
  questTitleResolver: () => Promise<string>;
  onConfirmed: (result: ScriptGenerateResult) => void;
  /** 부모(사진 선택 화면)가 들고 있는, 마지막으로 저장된 대본. 팝업을 열 때마다
   * 이 값으로 텍스트박스를 동기화한다 - 부모가 사진 선택 변경 등으로 이 값을
   * null로 초기화했다면 팝업도 빈 텍스트박스로 열려야 하기 때문. */
  savedCaptions: CaptionItem[] | null;
  savedTitle: string | null;
}) {
  const { width } = useWindowDimensions();
  const toast = useToast();
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [captions, setCaptions] = useState<CaptionItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [closing, setClosing] = useState(false);

  // ⭐ 수정: 팝업이 열릴 때마다 부모의 저장된 대본으로 내부 상태를 동기화한다.
  // 이게 없으면 부모가 captions를 초기화(예: 사진 선택 변경)해도 팝업은 이전에
  // 생성해둔 텍스트를 계속 들고 있어서(컴포넌트가 visible=false여도 unmount되지
  // 않음), 다시 열었을 때 텍스트박스에 낡은 대본이 그대로 보이는 버그가 있었다.
  useEffect(() => {
    if (!visible) return;
    if (savedCaptions) {
      setCaptions(savedCaptions);
      setTitle(savedTitle ?? '');
      setText(captionsToText(savedCaptions));
    } else {
      setCaptions(null);
      setTitle('');
      setText('');
    }
    // 팝업이 열리는 시점(visible: false -> true)에만 동기화한다. savedCaptions/savedTitle을
    // 의존성에 넣으면 팝업이 열려있는 동안 부모 상태가 바뀔 때마다 다시 동기화되어,
    // "생성하기"로 막 채운 텍스트박스를 덮어써버릴 수 있다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const runGenerate = async (): Promise<ScriptGenerateResult | null> => {
    if (shortsId == null || mediaKeys.length === 0) {
      toast.show('사진을 먼저 선택해주세요.');
      return null;
    }
    setLoading(true);
    try {
      const questTitle = await questTitleResolver();
      const result = await generateScript(shortsId, mediaKeys, questTitle);
      setCaptions(result.captions);
      setTitle(result.title);
      setText(captionsToText(result.captions));
      return result;
    } catch (error) {
      console.error('AI 대본 생성 실패:', error);
      toast.show('AI 자막 생성에 실패했습니다.'); // ⭐ 수정: "AI 대본" → "AI 자막"
      return null;
    } finally {
      setLoading(false);
    }
  };

  const onGenerate = () => {
    runGenerate();
  };

  // 사용자가 캡션을 수정했으면 닫히기 전에 검증(stateless)부터 통과시킨다 - 실패하면 닫지 않는다.
  const close = async () => {
    if (!captions) {
      onClose();
      return;
    }
    const edited = textToCaptions(text, captions);
    const changed = edited.some((c, i) => c.caption !== captions[i].caption);
    if (!changed) {
      onConfirmed({ shorts_id: shortsId as number, status: 'PENDING', title, captions });
      onClose();
      return;
    }
    try {
      setClosing(true);
      const validated = await updateScript(shortsId as number, title, edited);
      setCaptions(validated.captions);
      onConfirmed(validated);
      onClose();
    } catch (error: any) {
      const message = error?.response?.data?.detail ?? '수정한 대본 검증에 실패했습니다.';
      toast.show(message);
    } finally {
      setClosing(false);
    }
  };

  // ⭐ 수정: "자동 생성" → "적용하기". 새로 생성하지 않는다 - "생성하기"로 이미 만들어둔
  // 대본(현재 텍스트박스 내용)을 그대로 저장하고 사진 선택 화면으로 돌아간다.
  // close()와 동일한 저장 로직(편집했으면 검증 후 반영)을 그대로 재사용한다.
  const onApply = async () => {
    if (!captions) {
      toast.show('먼저 "생성하기"를 눌러 대본을 만들어주세요.');
      return;
    }
    await close();
  };

  return (
    <GamePopup visible={visible} onClose={close} width={Math.min(width - 48, 360)}>
      <View style={ai.header}>
        <Text style={ai.title}>AI 자막</Text>{/* ⭐ 수정: "AI대본" → "AI 자막" */}
        <Pressable onPress={close} hitSlop={10}>
          <Text style={ai.x}>✕</Text>
        </Pressable>
      </View>

      <View style={ai.scriptBox}>
        {loading ? (
          <ScriptGeneratingStatus />
        ) : (
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            textAlignVertical="top"
            placeholder="'생성하기'를 눌러 AI 자막을 만들어보세요" // ⭐ 수정: "AI 대본" → "AI 자막"
            placeholderTextColor={sf.trackSub}
            style={ai.scriptInput}
            selectionColor={colors.gold}
            editable={!!captions}
          />
        )}
      </View>

      <View style={ai.btnRow}>
        <View style={ai.btnHalf}>
          <SpringButton onPress={onGenerate} disabled={loading || closing} style={[ai.btn, ai.btnGenerate]}>
            <Text style={ai.btnGenerateText}>생성하기</Text>
          </SpringButton>
        </View>
        <View style={ai.btnHalf}>
          <SpringButton onPress={onApply} disabled={loading || closing} style={[ai.btn, ai.btnAuto]}>
            <Text style={ai.btnAutoText}>적용하기</Text>
          </SpringButton>
        </View>
      </View>
    </GamePopup>
  );
}

const ai = StyleSheet.create({
  header: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  title: { fontFamily: fonts.pixel, fontSize: 18, color: sf.cream },
  x: { color: sf.cream, fontSize: 20 },
  scriptBox: {
    width: '100%',
    minHeight: 240,
    backgroundColor: sf.glassFill,
    borderWidth: 1,
    borderColor: sf.goldSoft,
    borderRadius: 8,
    padding: 14,
  },
  scriptInput: {
    flex: 1,
    minHeight: 212,
    fontSize: 14,
    lineHeight: 24,
    color: sf.scriptText,
    fontFamily: fonts.bodyR,
    padding: 0,
  },
  progressWrap: { flex: 1, minHeight: 212, alignItems: 'center', justifyContent: 'center', gap: 14 },
  progressTrack: { width: '100%', height: 8, borderRadius: 4, backgroundColor: sf.chipInactive, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4, backgroundColor: colors.gold },
  progressLabel: { fontSize: 14, color: sf.scriptText, fontFamily: fonts.bodyM, textAlign: 'center' },
  progressElapsed: { fontSize: 12, color: sf.trackSub, fontFamily: fonts.bodyR },
  btnRow: { width: '100%', flexDirection: 'row', gap: 10, marginTop: 16 },
  btnHalf: { flex: 1 },
  btn: { height: 46, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  btnGenerate: { backgroundColor: colors.primaryDark, borderWidth: 1.5, borderColor: colors.gold },
  btnGenerateText: { fontFamily: fonts.pixel, fontSize: 15, color: colors.parchment },
  btnAuto: { backgroundColor: colors.xpGreen },
  btnAutoText: { fontFamily: fonts.pixel, fontSize: 15, color: colors.white },
});

/* ------------------------------------------------ 음악 preview inline bar */
// BackgroundMusic.preview_url(presigned URL)을 expo-video 플레이어로 재생한다.
// VideoView는 렌더링하지 않고(오디오만 필요) player 인스턴스만 붙여서 소리를 낸다.
function PreviewBar({ name, previewUrl }: { name: string; previewUrl: string | null }) {
  // player 정지는 별도 effect로 직접 호출하지 않는다 - useVideoPlayer가 컴포넌트
  // unmount 시 내부적으로 이미 player를 release하는데, 여기서 또 pause()를 부르면
  // "shared object that was already released" 네이티브 크래시로 이어진다.
  // PreviewBar는 트랙 전환/시트 닫힘 시 조건부 렌더링으로 unmount되므로, 그 자체로 정지된다.
  const player = useVideoPlayer(previewUrl, (p) => {
    p.loop = true;
    p.timeUpdateEventInterval = 0.25;
    if (previewUrl) p.play();
  });

  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { currentTime } = useEvent(player, 'timeUpdate', {
    currentTime: player.currentTime,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    bufferedPosition: 0,
  });

  const duration = player.duration || 0;
  const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0;

  if (!previewUrl) {
    return (
      <View style={ms.preview}>
        <Text style={ms.previewName}>이 트랙은 미리듣기를 지원하지 않습니다.</Text>
      </View>
    );
  }

  return (
    <View style={ms.preview}>
      <View style={{ flex: 1 }}>
        <Text style={ms.previewName}>{name}</Text>
        <View style={ms.progTrack}>
          <View style={[ms.progFill, { width: `${progress * 100}%` }]} />
        </View>
      </View>
      <SpringButton
        onPress={() => (isPlaying ? player.pause() : player.play())}
        style={ms.playBtn}
        pressScale={0.9}
      >
        {isPlaying ? <PauseBars /> : <PlayTri />}
      </SpringButton>
    </View>
  );
}

/* ---------------------------------------------------- 음악 선택 bottom sheet */
export function MusicSheet({
  visible,
  onClose,
  selectedBgmId,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  selectedBgmId: number | null;
  onSelect: (bgm: BackgroundMusic) => void;
}) {
  const { height } = useWindowDimensions();
  const [cat, setCat] = useState(0);
  const [categories, setCategories] = useState<string[]>(['전체']);
  const [tracks, setTracks] = useState<BackgroundMusic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null); // ⭐ 수정: 이제 인덱스가 아니라 expanded/previewing 중인 track의 bgm_id
  const prevVisible = useRef(false);

  // ⭐ 수정: 카테고리(mood_tag)별로 묶어서 "카테고리 제목" 아래에 "카테고리 노래1, 노래2..."
  // 형태로 나열 — 전체 탭에서는 신나는/발랄한/차분한 등 카테고리별 섹션으로 구분되고,
  // 특정 카테고리 칩을 선택하면 그 카테고리 하나만 섹션으로 보인다.
  const trackGroups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, BackgroundMusic[]>();
    for (const t of tracks) {
      const category = t.mood_tag || '기타';
      if (!map.has(category)) {
        map.set(category, []);
        order.push(category);
      }
      map.get(category)!.push(t);
    }
    return order.map((category) => ({ category, items: map.get(category)! }));
  }, [tracks]);

  // ⭐ 수정: 예전엔 "시트가 열릴 때 cat을 0으로 리셋"과 "cat이 바뀌면 목록을 다시 조회"를
  // 별도의 useEffect 두 개로 나누고, skipFirstFetch 플래그로 리셋 직후의 중복 조회를
  // 걸러내려 했다. 그런데 시트를 닫을 때 cat이 이미 0이었으면 setCat(0)이 "같은 값으로
  // 설정"이라 리렌더/이펙트가 아예 안 일어나고, 그 결과 skipFirstFetch가 true로 남는다.
  // 그 상태에서 사용자가 실제로 다른 카테고리를 눌러 cat이 바뀌면, 그 이펙트가 남아있던
  // skipFirstFetch를 대신 소비해버려서 정작 그 클릭의 조회 요청이 통째로 씹혔다
  // (한 번 눌러선 반영 안 되고 다른 칩 눌렀다 돌아와야 반영되는 것처럼 보인 버그의 원인).
  // "시트가 방금 열렸는지"를 별도 ref(prevVisible)로 직접 추적해서, 리셋이 필요한
  // 시점과 사용자가 실제로 카테고리를 누른 시점을 확실히 구분한다.
  useEffect(() => {
    const justOpened = visible && !prevVisible.current;
    prevVisible.current = visible;

    if (!visible) {
      // 시트를 닫아도 BottomSheet의 Modal은 visible prop만 바뀔 뿐 자식은 계속 마운트돼
      // 있으므로, 재생 중이던 미리듣기가 있으면 여기서 명시적으로 정지시켜야 한다.
      setOpen(null);
      return;
    }

    // 시트가 막 열렸는데 이전에 특정 카테고리로 필터링해뒀던 상태면, 먼저 '전체'로
    // 리셋만 하고 조회는 그 리셋으로 인한 다음 이펙트 실행(cat 변경)에서 하도록 미룬다.
    if (justOpened && cat !== 0) {
      setCat(0);
      return;
    }

    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const moodTag = cat === 0 ? undefined : categories[cat];
        const result = await getBackgroundMusicList(moodTag);
        if (!mounted) return;
        setTracks(result.items);
        if (cat === 0) {
          // '전체' 조회 결과로만 카테고리 칩 목록을 다시 구성한다 (필터링된 응답은
          // 그 카테고리 트랙만 담고 있어 전체 mood_tag 목록을 복원할 수 없음).
          const moodTags = Array.from(
            new Set(result.items.map((t) => t.mood_tag).filter((t): t is string => !!t)),
          );
          setCategories(['전체', ...moodTags]);
        }
      } catch (e) {
        console.error('배경음악 목록 조회 실패:', e);
        if (mounted) setError('음악 목록을 불러오지 못했습니다.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, cat]);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      contentStyle={[ms.sheet, { height: Math.round(height * 0.62) }]}
    >
      <View style={{ flex: 1 }}>
        <View style={ms.header}>
          <Text style={ms.title}>음악선택</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={ms.x}>✕</Text>
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={ms.chipsScroll}
          contentContainerStyle={ms.chipsRow}
        >
          {categories.map((label, i) => {
            const active = i === cat;
            return (
              <Pressable
                key={label}
                onPress={() => setCat(i)}
                style={[ms.chip, active ? ms.chipActive : ms.chipInactive]}
              >
                <Text style={[ms.chipText, active ? ms.chipTextActive : ms.chipTextInactive]}>{label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {loading ? (
          <View style={ms.stateWrap}>
            <Text style={ms.stateText}>음악 목록을 불러오는 중입니다</Text>
          </View>
        ) : error ? (
          <View style={ms.stateWrap}>
            <Text style={ms.stateText}>{error}</Text>
          </View>
        ) : tracks.length === 0 ? (
          <View style={ms.stateWrap}>
            <Text style={ms.stateText}>이 분위기의 음악이 아직 없습니다</Text>
          </View>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={ms.listPad} showsVerticalScrollIndicator={false}>
            {/* ⭐ 수정: 카테고리별 섹션 — "신나는 노래" 제목 아래에 신나는 노래1,2,3... 나열,
                그다음 "발랄한 노래" 제목 아래에 발랄한 노래1,2,3... 나열하는 예전 형식 복원 */}
            {trackGroups.map((group) => (
              <View key={group.category}>
                <Text style={ms.sectionHeader}>{group.category} 노래</Text>
                {group.items.map((t, idx) => {
                  const selected = t.bgm_id === selectedBgmId;
                  const displayName = `${group.category} 노래${idx + 1}`; // ⭐ 수정
                  return (
                    <View key={t.bgm_id}>
                      <Pressable
                        style={ms.trackRow}
                        onPress={() => {
                          setOpen((cur) => (cur === t.bgm_id ? null : t.bgm_id));
                          onSelect(t);
                        }}
                      >
                        <MusicNoteIcon />
                        <View style={{ flex: 1 }}>
                          <Text style={ms.trackName}>{displayName}</Text>
                        </View>
                        {selected ? (
                          <View style={ms.selectedBadge}>
                            <Text style={ms.selectedBadgeText}>✓</Text>
                          </View>
                        ) : null}
                      </Pressable>
                      {open === t.bgm_id ? <PreviewBar name={displayName} previewUrl={t.preview_url} /> : null}
                    </View>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </BottomSheet>
  );
}

const ms = StyleSheet.create({
  sheet: {
    backgroundColor: sf.sheetBg,
    borderTopWidth: 2,
    borderTopColor: colors.gold,
    paddingHorizontal: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  title: { fontFamily: fonts.pixel, fontSize: 18, color: sf.cream },
  x: { color: sf.cream, fontSize: 20 },
  chipsScroll: { flexGrow: 0 },
  chipsRow: { gap: 8, paddingHorizontal: 20, paddingTop: 2, paddingBottom: 12 },
  chip: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1 },
  chipActive: { backgroundColor: colors.primaryDark, borderColor: colors.gold },
  chipInactive: { backgroundColor: sf.chipInactive, borderColor: sf.goldSoft },
  chipText: { fontSize: 13, fontWeight: '700', fontFamily: fonts.bodyB },
  chipTextActive: { color: colors.parchment },
  chipTextInactive: { color: sf.cream },
  listPad: { paddingHorizontal: 20, paddingBottom: 8 },
  // ⭐ 수정: 카테고리 섹션 제목 ("신나는 노래" 등)
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: sf.trackSub,
    fontFamily: fonts.bodyB,
    paddingTop: 14,
    paddingBottom: 4,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: sf.goldLine,
  },
  trackName: { fontSize: 15, fontWeight: '600', color: sf.cream, fontFamily: fonts.bodyM },
  selectedBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedBadgeText: { color: colors.primaryDark, fontSize: 13, fontWeight: '800' },
  stateWrap: { paddingVertical: 40, alignItems: 'center', justifyContent: 'center' },
  stateText: { fontSize: 13, color: sf.trackSub, fontFamily: fonts.bodyR },
  preview: {
    backgroundColor: sf.greenTint,
    borderWidth: 1,
    borderColor: colors.xpGreen,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  previewName: { fontFamily: fonts.pixel, fontSize: 14, color: sf.cream },
  progTrack: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 2,
    marginTop: 8,
    overflow: 'hidden',
  },
  progFill: { height: '100%', backgroundColor: colors.xpGreen, borderRadius: 2 },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primaryDark,
    borderWidth: 1.5,
    borderColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
