/**
 * SCREEN 1 · 로그인 — dark green hero (twinkle stars, drifting particles, pixel
 * skyline, app icon + 선행퀘스트) with a white login sheet sliding up over it.
 * Email + password (show/hide) + 로그인하기 (sword) + 회원가입 link + kakao/google.
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  Pressable,
  Dimensions,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { colors, fonts, radii, shadow, heroGradient, brand } from '../theme';
import Starfield from '../components/Starfield';
import Skyline from '../components/Skyline';
import SpringButton from '../components/SpringButton';
import GdqInput from '../components/GdqInput';
import { MailIcon, LockIcon, SwordIcon, EyeOpen, EyeOff, HamburgerIcon, KakaoIcon, GoogleIcon } from '../components/PixelIcons';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { login } from '../api/auth';
import { socialLogin } from '../api/auth';
import Constants, { ExecutionEnvironment } from 'expo-constants';

/**
 * 【판단】 Expo Go 에서는 소셜 로그인 버튼을 눌러도 아무 일도 하지 않는다.
 * 카카오·구글 SDK 는 네이티브 모듈이라 Expo Go 앱 안에 들어 있지 않다.
 * 맨 위에서 import 하면 Expo Go 는 이 화면을 여는 순간 죽는다.
 * 그래서 Expo Go 가 아닐 때(개발 빌드·APK)만 require 로 불러온다.
 * 버튼은 그대로 보여 화면 모양은 개발 빌드와 같다.
 */
const IS_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

const kakaoSDK: typeof import('@react-native-seoul/kakao-login') | null =
  IS_EXPO_GO ? null : require('@react-native-seoul/kakao-login');
const GoogleSignin: typeof import('@react-native-google-signin/google-signin').GoogleSignin | null =
  IS_EXPO_GO ? null : require('@react-native-google-signin/google-signin').GoogleSignin;

/**
 * 【판단】 구글도 카카오처럼 네이티브 SDK 를 쓴다. 원래는 expo-auth-session 으로
 * 브라우저를 띄웠는데, 구글이 안드로이드의 맞춤 URI 스킴(com.xxx:/oauthredirect)을
 * 앱 사칭 위험을 이유로 폐지해서 그 방식은 400 invalid_request 로 막힌다.
 * 네이티브 SDK 는 브라우저를 거치지 않아 이 제약을 받지 않는다.
 *
 * 【기능】 configure 는 앱이 켜질 때 한 번만 하면 되므로 컴포넌트 밖에 둔다.
 * webClientId 를 넣는 게 맞다. 안드로이드에서도 SDK 는 이 값으로 id_token 을
 * 발급받고, 백엔드(verify_google_id_token)가 검증할 때 쓰는 값과 같아야 한다.
 */
GoogleSignin?.configure({
  webClientId: '530602948532-eoif1hq6bshlgb7tn5r1dcuruvelubsa.apps.googleusercontent.com',
  iosClientId: '530602948532-3es8kq72k78i1nc5l5qve88q6tofg3ua.apps.googleusercontent.com',
});
type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;


/** 인터랙션 갤러리 #6 Typing — 한 글자씩 타이핑 + 깜빡이는 커서 */
function TypewriterSub({ text }: { text: string }) {
  const [n, setN] = useState(0);
  const cursor = useSharedValue(1);

  useEffect(() => {
    // 등장 애니메이션 이후 시작, 110ms/글자 (갤러리와 동일 텐포)
    let i = 0;
    const start = setTimeout(() => {
      const t = setInterval(() => {
        i += 1;
        setN(i);
        if (i >= text.length) clearInterval(t);
      }, 110);
    }, 600);
    cursor.value = withRepeat(withTiming(0, { duration: 500, easing: Easing.steps(2, true) }), -1, true);
    return () => clearTimeout(start);
  }, [text]);

  const cursorStyle = useAnimatedStyle(() => ({ opacity: cursor.value }));

  return (
    <View style={styles.subRow}>
      <Text style={styles.brandSub}>{text.slice(0, n)}</Text>
      <Animated.View style={[styles.cursor, cursorStyle]} />
    </View>
  );
}

export default function LoginScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [showPw, setShowPw] = useState(false);
  const { signIn } = useAuth();

  const toast = useToast();
const [ email, setEmail ] = useState('');
const [ password, setPassword ] = useState('');
const [loading, setLoading] = useState(false);
const onLogin = async () => {
  if (!email.trim() || !password) {
    toast.show('이메일과 비밀번호를 입력해 주세요.');
    return;
  }
  setLoading(true)
  try {
    // 【기능】 signIn 이 로그인 상태를 켜면 RootNavigator 가 로그인 후 화면
    //        묶음으로 통째로 바뀐다. 화면을 직접 넘길 필요가 없다.
    await signIn(await login(email.trim(), password));
  } catch (err: any) {
    const detail = err?.response?.data?.detail;
    toast.show(detail ?? '로그인에 실패했습니다. 다시 시도해 주세요.');
  } finally {
    setLoading(false);
  }
};

const handleGoogle = async () => {
  if (!GoogleSignin) return; // Expo Go: 아무 일도 하지 않는다
  try {
    // 【기능】 구글 로그인은 기기의 Play 서비스를 통해 이뤄진다. 없거나 낡은
    //        기기면 여기서 걸러져 아래 signIn 이 이상하게 실패하지 않는다.
    await GoogleSignin.hasPlayServices();

    const result = await GoogleSignin.signIn();

    // 【문법】 v13 부터 signIn 은 {type, data} 를 돌려준다. 사용자가 창을 닫으면
    //        예외가 아니라 type:'cancelled' 로 온다. 취소는 실패가 아니므로
    //        아무 말 없이 끝낸다.
    if (result.type !== 'success') return;

    const idToken = result.data.idToken;
    if (!idToken) {
      toast.show('구글 로그인에 실패했습니다.');
      return;
    }

    const { token, isNewUser } = await socialLogin(idToken, 'google');
    if (isNewUser) {
      // 【판단】 신규 가입자는 아직 프로필을 안 채웠다. 여기서 로그인 상태를
      //        켜버리면 화면 묶음이 바뀌면서 Profile 화면이 사라진다.
      // 【기능】 social:true 를 넘긴다. 소셜은 social-login 단계에서 계정이 이미
      //        만들어졌으므로, Profile 화면이 register 를 부르면 422 가 난다.
      navigation.navigate('Profile', { social: true });
    } else {
      await signIn(token);
    }
  } catch (err: any) {
    toast.show('구글 로그인에 실패했습니다.');
  }
}

const handleKakao = async () => {
    if (!kakaoSDK) return; // Expo Go: 아무 일도 하지 않는다
    try {

      const result = await kakaoSDK.login();

      const { token, isNewUser } = await socialLogin(result.accessToken, 'kakao');

      if (isNewUser) {
        navigation.navigate('Profile', { social: true });
      } else {
        await signIn(token);
      }
    } catch (err: any) {
      const message = String(err?.message ?? '');
      if (message.toLowerCase().includes('cancel')) return;
      toast.show('카카오 로그인에 실패했습니다.');
    }
  };

  const HERO_H = Math.max(400, Dimensions.get('window').height * 0.5);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {/* ---- hero ---- */}
      <LinearGradient
        colors={heroGradient.colors}
        locations={heroGradient.locations}
        style={[styles.hero, { height: HERO_H }]}
      >
        <Starfield />
        <View style={styles.skyline} pointerEvents="none">
          <Skyline width={width} height={150} />
        </View>
        <View style={[styles.logoBlock, { top: insets.top + 22 }]}>
          <Image source={brand.appIcon} style={styles.appIcon} />
          <Text style={styles.brandTitle}>선행퀘스트</Text>
          <TypewriterSub text="오늘의 선행 퀘스트를 시작하세요" />
        </View>
      </LinearGradient>

      {/* ---- hamburger ---- */}
      <Pressable style={[styles.ham, { top: insets.top + 6 }]} hitSlop={8}>
        <HamburgerIcon size={22} color={colors.parchment} />
      </Pressable>

      {/* ---- login sheet ---- */}
      <Animated.View
        entering={FadeInDown.duration(400)}
        style={[styles.card, { marginTop: HERO_H - 96 }]}
      >
        <LinearGradient
          colors={['#FFF8E7', '#FFEFC9', '#FFF8E7']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.goldStrip}
        />
        <ScrollView
          contentContainerStyle={styles.cardBody}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.handle} />
          <Text style={styles.cardTitle}>로그인</Text>

          <Text style={styles.label}>이메일</Text>
          <GdqInput
            style={styles.inputSpacing}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder="이메일을 입력하세요"
            leftIcon={<MailIcon />}
          />

          <Text style={styles.label}>비밀번호</Text>
          <GdqInput
            value={password}
            onChangeText={setPassword}
            placeholder="비밀번호를 입력하세요"
            secureTextEntry={!showPw}
            autoCapitalize='none'
            leftIcon={<LockIcon />}
            rightAccessory={showPw ? <EyeOff /> : <EyeOpen />}
            onRightPress={() => setShowPw((s) => !s)}
          />

          <SpringButton style={styles.primaryBtn} onPress={onLogin} disabled={loading}>
  <SwordIcon />
  <Text style={styles.primaryBtnText}>{loading ? '로그인 중...' : '로그인하기'}</Text>
</SpringButton>

          {/*
            【판단】 원래는 부모 <Text> 안에 <Text onPress>를 중첩해 링크를 만들었다.
            iOS 실기기/시뮬레이터에서 이 방식은 탭이 간헐적으로 무시된다(안드로이드는
            정상). 눌리는 영역을 Pressable 이라는 진짜 뷰로 만들어야 확실히 잡힌다.
            hitSlop 은 글자가 작아 손가락으로 정확히 짚기 어려운 것을 보완한다.
          */}
          <View style={styles.signupRow}>
            <Text style={styles.signupHint}>아직 영웅이 아니신가요?</Text>
            <Pressable onPress={() => navigation.navigate('Terms')} hitSlop={10}>
              <Text style={styles.signupLink}>회원가입</Text>
            </Pressable>
          </View>

          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <Text style={styles.dividerText}>또는</Text>
            <View style={styles.divider} />
          </View>

          <View style={styles.socialRow}>
            <SpringButton style={[styles.socialBtn, { backgroundColor: colors.kakao }]} onPress={handleKakao}>
  <KakaoIcon />
  <Text style={[styles.socialText, { color: colors.kakaoText }]}>카카오</Text>
</SpringButton>
            <SpringButton style={[styles.socialBtn, styles.googleBtn]} onPress={handleGoogle}>
              <GoogleIcon />
              <Text style={[styles.socialText, { color: colors.textPrimary }]}>구글</Text>
            </SpringButton>
          </View>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  hero: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  skyline: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 150 },
  logoBlock: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: 13 },
  appIcon: { width: 112, height: 112 },
  brandTitle: {
    fontFamily: fonts.pixel,
    fontSize: 30,
    color: colors.white,
    letterSpacing: 1,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 0,
  },
  brandSub: { fontSize: 13, color: 'rgba(255,255,255,0.62)', fontFamily: fonts.bodyR },
  subRow: { flexDirection: 'row', alignItems: 'center', minHeight: 19 },
  cursor: { width: 2, height: 14, marginLeft: 3, backgroundColor: 'rgba(255,255,255,0.75)' },
  ham: {
    position: 'absolute',
    right: 18,
    zIndex: 21,
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(255,248,231,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(212,160,23,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    flex: 1,
    backgroundColor: colors.white,
    borderTopLeftRadius: radii.cardLg,
    borderTopRightRadius: radii.cardLg,
    overflow: 'hidden',
    ...shadow.card,
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.14,
    shadowRadius: 30,
  },
  goldStrip: { height: 5, width: '100%' },
  cardBody: { paddingHorizontal: 24, paddingTop: 22, paddingBottom: 40 },
  handle: { width: 38, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB', alignSelf: 'center', marginBottom: 16 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginBottom: 20, fontFamily: fonts.bodyB },
  label: { fontSize: 12, fontWeight: '600', color: colors.textPrimary, marginBottom: 7, fontFamily: fonts.bodyM },
  inputSpacing: {},
  primaryBtn: {
    height: 52,
    borderRadius: radii.button,
    backgroundColor: colors.primaryDark,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginTop: 20,
    ...shadow.button,
  },
  primaryBtnText: { color: colors.white, fontSize: 16, fontWeight: '700', fontFamily: fonts.bodyB },
  signupRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 14 },
  signupHint: { textAlign: 'center', fontSize: 13, color: colors.textSecondary, fontFamily: fonts.bodyR },
  signupLink: { color: colors.primaryDark, fontWeight: '700', textDecorationLine: 'underline', fontFamily: fonts.bodyB },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 16 },
  divider: { flex: 1, height: 1, backgroundColor: colors.divider },
  dividerText: { fontSize: 12, color: colors.textMuted, fontFamily: fonts.bodyR },
  socialRow: { flexDirection: 'row', gap: 12 },
  socialBtn: {
    flex: 1,
    height: 48,
    borderRadius: radii.input,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  googleBtn: { backgroundColor: colors.googleBg, borderWidth: 1, borderColor: colors.inputBorder },
  socialText: { fontSize: 14, fontWeight: '600', fontFamily: fonts.bodyM },
});
