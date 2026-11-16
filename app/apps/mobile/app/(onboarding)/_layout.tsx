import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { useTheme } from '@kc/ui';
import { OnboardingReplayBanner } from '../../src/components/onboarding/OnboardingReplayBanner';
import { useOnboardingReplayStore } from '../../src/store/onboardingReplayStore';

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';

export default function OnboardingLayout() {
  const { colors } = useTheme();
  // FR-ADMIN-035: however the onboarding is left (finished, exit button, sign-out), a replay ends
  // with it, so the sandbox flag can never leak into a later real onboarding.
  useEffect(() => () => useOnboardingReplayStore.getState().stop(), []);
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <OnboardingReplayBanner />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          gestureEnabled: false,
          animation: 'slide_from_right',
          animationDuration: 280,
        }}
      >
        <Stack.Screen name="about-intro" />
        <Stack.Screen name="basic-info" />
        <Stack.Screen name="photo" />
        <Stack.Screen name="tour" />
      </Stack>
    </View>
  );
}
