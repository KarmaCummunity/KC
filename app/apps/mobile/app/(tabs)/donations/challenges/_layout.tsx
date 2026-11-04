// Challenges world (docs/spec/10_challenges.md, 05 §5.12) — stack: list and detail. Opening a challenge is a category of the unified create form (D100).
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { nestedStackGestureOptions } from '../../../../src/navigation/nestedStackGestureOptions';
import { WorldLaunchGateByFlag } from '../../../../src/components/worlds/WorldLaunchGate';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function ChallengesLayout() {
  const { t } = useTranslation();
  // D60 — while the challenges launch flag is off the whole world is a portal, deep links included.
  return (
    <WorldLaunchGateByFlag flagKey="world_challenges_enabled">
      <Stack
        screenOptions={{ ...nestedStackGestureOptions, headerShown: true, headerBackTitle: t('general.back') }}
      >
        <Stack.Screen name="index" options={{ headerTitle: t('challenges.title') }} />
        <Stack.Screen name="[challengeId]" options={{ headerTitle: t('challenges.title') }} />
      </Stack>
    </WorldLaunchGateByFlag>
  );
}
