// Onboarding step 3 — FR-AUTH-011 (camera+gallery, resize+upload, skip→silhouette).
import React, { useState } from 'react';
import { View, ActivityIndicator, Platform, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { makeUseStyles, typography, spacing, radius, iconSize, useTheme, Text } from '@kc/ui';
import { isLayoutRtl } from '../../src/lib/rtlLayout';

/**
 * Pin the camera badge to the avatar's reading-end bottom corner.
 * Native auto-mirrors `end`; RN-Web ignores `start`/`end` for absolute
 * positioning, so on web we resolve RTL live and emit a physical key.
 */
function cameraBadgeCornerEnd(): Pick<ViewStyle, 'left' | 'right' | 'end'> {
  if (Platform.OS !== 'web') return { end: spacing.md };
  return isLayoutRtl() ? { left: spacing.md } : { right: spacing.md };
}
import { AvatarInitials } from '../../src/components/AvatarInitials';
import { OnboardingStepHeader } from '../../src/components/OnboardingStepHeader';
import { PhotoSourceSheet } from '../../src/components/PhotoSourceSheet';
import { AnimatedEntry } from '../../src/components/animations/AnimatedEntry';
import { HeroHalo } from '../../src/components/animations/HeroHalo';
import { PressableScale } from '../../src/components/animations/PressableScale';
import { staggerDelay } from '../../src/lib/animations/motion';
import { useOnboardingPhotoFlow } from '../../src/hooks/useOnboardingPhotoFlow';
import { PrimaryButton, SecondaryButton } from '../../src/components/ui/Buttons';

const HALO_SIZE = 196;
const AVATAR_SIZE = 128;

export default function OnboardingPhotoScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [sheetVisible, setSheetVisible] = useState(false);
  const {
    session, avatarUrl, hasAvatar,
    uploading, finalizing, busy,
    pick, remove, finalize, goBack,
  } = useOnboardingPhotoFlow();

  const handlePick = async (source: Parameters<typeof pick>[0]) => {
    setSheetVisible(false);
    await pick(source);
  };
  const handleRemove = async () => {
    setSheetVisible(false);
    await remove();
  };
  const openSheet = () => !busy && setSheetVisible(true);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <OnboardingStepHeader
          step={3}
          onSkip={finalize}
          onBack={goBack}
          skipDisabled={busy}
          backDisabled={busy}
        />

        <AnimatedEntry delay={staggerDelay(0)} style={styles.avatarWrap}>
          <PressableScale
            onPress={openSheet}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={hasAvatar ? t('onboarding.photoReplaceA11y') : t('onboarding.photoAddA11y')}
          >
            <HeroHalo size={HALO_SIZE}>
              <AvatarInitials
                name={session?.displayName ?? t('profile.fallbackName')}
                avatarUrl={avatarUrl}
                size={AVATAR_SIZE}
              />
            </HeroHalo>
            <View style={styles.cameraBadge}>
              <Ionicons name="camera" size={iconSize.md} color={colors.textInverse} />
            </View>
            {uploading && (
              <View style={styles.avatarSpinner}>
                <ActivityIndicator color={colors.textInverse} size="large" />
              </View>
            )}
          </PressableScale>
        </AnimatedEntry>

        <AnimatedEntry delay={staggerDelay(1)}>
          <Text style={styles.title}>{t('onboarding.stepPhoto')}</Text>
        </AnimatedEntry>

        <AnimatedEntry delay={staggerDelay(2)}>
          <Text style={styles.subtitle}>{t('onboarding.photoSubtitle')}</Text>
        </AnimatedEntry>

        <AnimatedEntry delay={staggerDelay(3)} style={styles.changeBtnWrap}>
          <SecondaryButton
            label={hasAvatar ? t('onboarding.photoReplaceCta') : t('onboarding.photoChooseCta')}
            icon={hasAvatar ? 'swap-horizontal-outline' : 'image-outline'}
            size="md"
            disabled={busy}
            onPress={openSheet}
          />
        </AnimatedEntry>

        <View style={styles.spacer} />

        <AnimatedEntry delay={staggerDelay(4)}>
          <PrimaryButton
            label={hasAvatar ? t('onboarding.photoContinueWithCta') : t('onboarding.photoContinueWithoutCta')}
            icon="arrow-back"
            fullWidth
            loading={finalizing}
            disabled={busy}
            onPress={finalize}
          />
        </AnimatedEntry>

        <AnimatedEntry delay={staggerDelay(5)}>
          <Text style={styles.hint}>{t('onboarding.photoHint')}</Text>
        </AnimatedEntry>
      </View>

      <PhotoSourceSheet
        visible={sheetVisible}
        canRemove={hasAvatar}
        onPick={handlePick}
        onRemove={handleRemove}
        onClose={() => setSheetVisible(false)}
      />
    </SafeAreaView>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.base,
    paddingBottom: spacing.base,
    gap: spacing.base,
  },
  avatarWrap: { alignItems: 'center', marginTop: spacing.base, marginBottom: spacing.xs },
  cameraBadge: {
    position: 'absolute',
    bottom: spacing.md,
    ...cameraBadgeCornerEnd(),
    width: 36, height: 36, borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: colors.surface,
  },
  avatarSpinner: {
    position: 'absolute',
    width: AVATAR_SIZE, height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: colors.overlay,
    justifyContent: 'center', alignItems: 'center',
  },
  title: {
    ...typography.h1,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.bodyLarge,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.sm,
  },
  changeBtnWrap: { alignItems: 'center' },
  spacer: { flex: 1 },
  hint: {
    ...typography.caption,
    color: colors.textDisabled,
    textAlign: 'center',
  },
}));
