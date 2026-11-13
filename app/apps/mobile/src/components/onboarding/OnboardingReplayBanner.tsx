// FR-ADMIN-035 AC3 — the strip shown above every onboarding step during an admin replay: it says
// the flow is a preview and offers the one-tap way back to the admin portal.
import React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { useOnboardingReplayStore } from '../../store/onboardingReplayStore';

/** Renders nothing outside a replay, so the real onboarding is untouched. */
export function OnboardingReplayBanner(): React.ReactElement | null {
  const styles = useStyles();
  const router = useRouter();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const active = useOnboardingReplayStore((s) => s.active);
  const stop = useOnboardingReplayStore((s) => s.stop);

  if (!active) return null;

  const exitToPortal = () => {
    stop();
    router.replace('/(admin)');
  };

  return (
    <View testID="onboarding-replay-banner" style={[styles.banner, { paddingTop: insets.top + spacing.xs }]}>
      <Text style={styles.title} accessibilityRole="text">
        {t('onboardingReplay.bannerTitle')}
      </Text>
      <Pressable
        testID="onboarding-replay-exit"
        onPress={exitToPortal}
        accessibilityRole="button"
        accessibilityLabel={t('onboardingReplay.exitCta')}
        hitSlop={8}
        style={({ pressed }) => [styles.exit, pressed && styles.exitPressed]}
      >
        <Text style={styles.exitText}>{t('onboardingReplay.exitCta')}</Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  banner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.xs,
    backgroundColor: colors.warningLight,
  },
  title: { ...typography.bodySmall, color: colors.textPrimary, flexShrink: 1 },
  exit: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  exitPressed: { opacity: 0.6 },
  exitText: { ...typography.label, color: colors.primary },
}));
