// Onboarding step 4 — FR-AUTH-012
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { makeUseStyles, spacing } from '@kc/ui';
import { OnboardingStepHeader } from '../../src/components/OnboardingStepHeader';
import { TourSlidePager, type TourSlide } from '../../src/components/animations/TourSlidePager';
import { PrimaryButton } from '../../src/components/ui/Buttons';

export default function OnboardingTourScreen() {
  const styles = useStyles();
  const router = useRouter();
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);

  const slides = useMemo<readonly TourSlide[]>(
    () => [
      {
        icon: 'gift-outline',
        title: t('onboarding.tourGiveAndAskTitle'),
        body: t('onboarding.tourGiveAndAskBody'),
      },
      {
        icon: 'chatbubbles-outline',
        title: t('onboarding.tourChatTitle'),
        body: t('onboarding.tourChatBody'),
      },
      {
        icon: 'checkmark-circle-outline',
        title: t('onboarding.tourMarkDeliveredTitle'),
        body: t('onboarding.tourMarkDeliveredBody'),
      },
    ],
    [t],
  );

  const isLast = index === slides.length - 1;

  const handleNext = () => {
    if (isLast) router.replace('/(tabs)');
    else setIndex(index + 1);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerPad}>
        <OnboardingStepHeader
          step={4}
          onSkip={() => router.replace('/(tabs)')}
          onBack={() => router.replace('/(onboarding)/photo')}
        />
      </View>
      <TourSlidePager slides={slides} index={index} onIndexChange={setIndex} />
      <View style={styles.footer}>
        <PrimaryButton
          label={isLast ? t('onboarding.tourLetsStartCta') : t('onboarding.tourNextCta')}
          icon="arrow-back"
          fullWidth
          onPress={handleNext}
        />
      </View>
    </SafeAreaView>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  headerPad: { paddingHorizontal: spacing.xl, paddingTop: spacing.base },
  footer: { paddingHorizontal: spacing.xl, paddingBottom: spacing.base },
}));
