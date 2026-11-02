// Onboarding step 1 of 4 — FR-AUTH-018 (mini about before FR-AUTH-010)
import React from 'react';
import { View, ScrollView, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { makeUseStyles, typography, spacing, radius, iconSize, useTheme, Text } from '@kc/ui';
import { AnimatedEntry } from '../../src/components/animations/AnimatedEntry';
import { HeroHalo } from '../../src/components/animations/HeroHalo';
import { OnboardingStepHeader } from '../../src/components/OnboardingStepHeader';
import { staggerDelay } from '../../src/lib/animations/motion';
import { PrimaryButton } from '../../src/components/ui/Buttons';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const PILLARS: ReadonlyArray<{ readonly icon: IoniconName; readonly key: 'pillarFree' | 'pillarNoAds' | 'pillarNonProfit' }> = [
  { icon: 'heart-outline', key: 'pillarFree' },
  { icon: 'eye-off-outline', key: 'pillarNoAds' },
  { icon: 'leaf-outline', key: 'pillarNonProfit' },
];

export default function OnboardingAboutIntroScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();

  const goBasicInfo = () => router.replace('/(onboarding)/basic-info');

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerPad}>
        <OnboardingStepHeader step={1} onSkip={goBasicInfo} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <AnimatedEntry delay={staggerDelay(0)} style={styles.logoWrap}>
          <HeroHalo size={220}>
            <Image
              source={require('../../assets/logo.png')}
              style={styles.logo}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
          </HeroHalo>
        </AnimatedEntry>

        <AnimatedEntry delay={staggerDelay(1)}>
          <Text style={styles.title}>{t('onboarding.aboutIntroTitle')}</Text>
        </AnimatedEntry>

        <AnimatedEntry delay={staggerDelay(2)}>
          <Text style={styles.tagline}>{t('aboutContent.tagline')}</Text>
        </AnimatedEntry>

        <AnimatedEntry delay={staggerDelay(3)}>
          <Text style={styles.body}>{t('onboarding.aboutIntroBody')}</Text>
        </AnimatedEntry>

        <AnimatedEntry delay={staggerDelay(5)}>
          <Text style={styles.hint}>{t('onboarding.aboutIntroFinePrint')}</Text>
        </AnimatedEntry>

        <AnimatedEntry delay={staggerDelay(4)} style={styles.pillars}>
          {PILLARS.map((p) => (
            <View key={p.key} style={styles.pillar}>
              <View style={styles.pillarIcon}>
                <Ionicons name={p.icon} size={iconSize.xl} color={colors.primary} />
              </View>
              <Text style={styles.pillarLabel}>{t(`onboarding.${p.key}`)}</Text>
            </View>
          ))}
        </AnimatedEntry>
      </ScrollView>

      <AnimatedEntry delay={staggerDelay(5)} style={styles.footer}>
        <PrimaryButton label={t('onboarding.aboutIntroCta')} icon="arrow-back" fullWidth onPress={goBasicInfo} />
      </AnimatedEntry>
    </SafeAreaView>
  );
}

const LOGO_SIZE = 148;

const useStyles = makeUseStyles(({ colors }) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  headerPad: { paddingHorizontal: spacing.xl, paddingTop: spacing.base },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.base,
    paddingBottom: spacing.lg,
    gap: spacing.base,
    alignItems: 'center',
  },
  logoWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  logo: { width: LOGO_SIZE, height: LOGO_SIZE },
  title: {
    ...typography.h1,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  tagline: {
    ...typography.h3,
    color: colors.primaryDark,
    textAlign: 'center',
  },
  body: {
    ...typography.bodyLarge,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.sm,
  },
  pillars: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: spacing.base,
    gap: spacing.sm,
  },
  hint: {
    ...typography.bodySmall,
    color: colors.textDisabled,
    textAlign: 'center',
  },
  pillar: { flex: 1, alignItems: 'center', gap: spacing.xs },
  pillarIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.primarySurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillarLabel: {
    ...typography.caption,
    ...typography.semiBold,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  footer: { paddingHorizontal: spacing.xl, paddingBottom: spacing.base },
}));
