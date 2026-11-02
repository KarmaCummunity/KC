import React from 'react';
import { Stack } from 'expo-router';
import { useTheme } from '@kc/ui';

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';

export default function OnboardingLayout() {
  const { colors } = useTheme();
  return (
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
  );
}
