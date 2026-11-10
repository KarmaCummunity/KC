// Mapped to spec: docs/spec/10_challenges.md — challenge detail uses the post-detail shell.
import React, { lazy, Suspense } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useTheme } from '@kc/ui';

const ChallengePostDetail = lazy(() => import('../../../../src/screens/challenges/ChallengePostDetail'));

export default function ChallengeDetailRoute() {
  const { colors } = useTheme();
  return (
    <Suspense
      fallback={
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      }
    >
      <ChallengePostDetail />
    </Suspense>
  );
}
