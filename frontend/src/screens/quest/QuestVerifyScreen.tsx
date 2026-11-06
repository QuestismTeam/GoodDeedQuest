/**
 * SCREEN 4 · 인증 팝업 (route QuestVerify) — transparent modal over the detail screen.
 * 퀘스트 종류에 따라 대표 증빙이 갈린다.
 *   GOOD_DEED(개인 선행) → 동영상 1개   |   VOLUNTEER(봉사) → VMS 봉사활동 확인서 사진
 * 대표 증빙 + 보조 사진(최대 4장)을 올리면 AI가 검토한다.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { SlideInDown } from 'react-native-reanimated';
import { colors, fonts, radii } from '../../theme';
import SpringButton from '../../components/SpringButton';
import { useToast } from '../../components/Toast';
import PhotoPicker from '../../components/PhotoPicker';
import VideoPicker from '../../components/VideoPicker';
import { uploadOne, submitVerification } from '../../api/questVerification';
import { isVideoQuest } from '../../api/quest';
import { AiIcon, SpinnerRing } from './_parts';

type Stage = 'form' | 'uploading' | 'verifying';

export default function QuestVerifyScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const title = route?.params?.title ?? '공원 플로깅';
  const toast = useToast();
  const questId = route?.params?.questId ?? 1;
  const isVideo = isVideoQuest(route?.params?.questType ?? 'GOOD_DEED');

  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [stage, setStage] = useState<Stage>('form');

  // 동영상 퀘스트는 영상이, 봉사 퀘스트는 확인서 사진이 대표 증빙이다.
  const hasPrimary = isVideo ? videoUri !== null : photos.length > 0;
  const disabled = !hasPrimary || stage !== 'form';
  // 동영상 모드에선 photos 전부가 보조. 사진 모드에선 photos[0]이 대표.
  const extraPhotos = isVideo ? photos : photos.slice(1);

  const onSubmit = async () => {
    if (disabled) return;
    setStage('uploading');
    try {
      const repKey = isVideo
        ? await uploadOne(questId, videoUri!, 'video/mp4')
        : await uploadOne(questId, photos[0]);

      const settled = await Promise.allSettled(extraPhotos.map((uri) => uploadOne(questId, uri)));

      const extraKeys = settled
        .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
        .map((r) => r.value);
      const failedCount = settled.length - extraKeys.length;
      if (failedCount > 0) {
        toast.show(`추가 사진 ${failedCount}장은 업로드되지 않아 제외했어요.`, 4000);
      }

      setStage('verifying');
      const result = await submitVerification(questId, repKey, extraKeys);

      if (result.challenge_required) {
        // 진위가 의심스러워 손글씨 코드로 한 번 더 확인한다
        navigation.replace('QuestChallenge', {
          code: result.challenge_code,
          submissionId: result.submission_id,
          questId,
          title,
        });
      } else if (result.verified) {
        navigation.replace('QuestComplete', {
          exp: result.xp_gained,
          point: result.points_gained,
          title,
          unlockedBadges: result.unlocked_badges,
        });
      } else {
        setStage('form')
        // 서버가 사유를 안 준 경우까지 대비한다. 빈 토스트가 뜨면 사용자는
        // 무엇이 잘못됐는지도 모른 채 같은 자료를 또 올리게 된다.
        toast.show(`인증 거절: ${result.reason || '사유를 확인할 수 없습니다.'}`);
      }
    } catch (err: any) {
      setStage('form');
      // 【판단】 서버가 보낸 사유를 그대로 띄운다. 원래는 전부 "오류가 발생했습니다"
      //        하나로 뭉뚱그려서, 하루 제출 횟수 초과·잘못된 업로드 경로·AI 서버
      //        장애가 화면에서 구분되지 않았다. 사용자는 왜 막혔는지 알아야
      //        다시 시도할지 기다릴지 판단할 수 있다.
      const detail = err?.response?.data?.detail;
      toast.show(
        typeof detail === 'string'
          ? `인증 실패: ${detail}`
          : '인증 처리 중 오류가 발생했습니다. 다시 시도해 주세요.'
      );
    }
  };

  const submitLabel = hasPrimary
    ? '제출하기'
    : isVideo
      ? '동영상을 추가해주세요'
      : '봉사활동 확인서를 추가해주세요';

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <Pressable style={styles.backdrop} onPress={() => navigation.goBack()} />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav} pointerEvents="box-none">
        <Animated.View entering={SlideInDown.duration(260)} style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.handle} />
          <Text style={styles.title}>{title} 인증</Text>

          {/* upload area — 동영상 퀘스트는 영상 + 보조 사진, 봉사 퀘스트는 확인서 사진 */}
          <View style={styles.pickerWrap}>
            {isVideo ? (
              <>
                <VideoPicker
                  videoUri={videoUri}
                  onChange={setVideoUri}
                  maxSeconds={30}
                  disabled={stage !== 'form'}
                />
                {videoUri && (
                  <View style={styles.extraWrap}>
                    <Text style={styles.extraLabel}>보조 사진 (선택)</Text>
                    <PhotoPicker
                      photos={photos}
                      onChange={setPhotos}
                      max={4}
                      variant="extras"
                      disabled={stage !== 'form'}
                    />
                  </View>
                )}
              </>
            ) : (
              <PhotoPicker photos={photos} onChange={setPhotos} max={5} disabled={stage !== 'form'} />
            )}
          </View>

          {/* AI status */}
          <View style={styles.aiInfo}>
            <AiIcon />
            <Text style={styles.aiInfoText}>
              {isVideo ? '제출하면 AI가 동영상을 검토해요' : '제출하면 AI가 봉사활동 확인서를 검토해요'}
            </Text>
          </View>

          {/* submit */}
          <SpringButton
            onPress={onSubmit}
            disabled={disabled}
            style={[styles.submit, { backgroundColor: hasPrimary ? colors.primaryDark : colors.disabled }]}
          >
            {stage !== 'form' ? (
              <View style={styles.loadingRow}>
                <SpinnerRing size={18} />
                <Text style={styles.submitText}>
                  {stage === 'uploading' ? (isVideo ? '동영상 업로드 중...' : '사진 업로드 중...') : 'AI가 검토 중...'}
                </Text>
              </View>
            ) : (
              <Text style={styles.submitText}>{submitLabel}</Text>
            )}
          </SpringButton>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)' },
  kav: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radii.cardLg,
    borderTopRightRadius: radii.cardLg,
    paddingHorizontal: 20,
    paddingTop: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.3,
    shadowRadius: 40,
    elevation: 20,
  },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.inputBorder, alignSelf: 'center', marginBottom: 16 },
  title: { textAlign: 'center', fontFamily: fonts.pixel, fontSize: 16, color: '#3A2A12', marginBottom: 18 },

  pickerWrap: { marginBottom: 14 },
  extraWrap: { marginTop: 14 },
  extraLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginBottom: 8, fontFamily: fonts.bodyM },

  aiInfo: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.screenBg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16 },
  aiInfoText: { fontSize: 12, fontWeight: '600', color: colors.primaryDark, fontFamily: fonts.bodyM },

  submit: { height: 52, borderRadius: radii.button, alignItems: 'center', justifyContent: 'center' },
  submitText: { color: colors.white, fontSize: 16, fontWeight: '700', fontFamily: fonts.bodyB },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
