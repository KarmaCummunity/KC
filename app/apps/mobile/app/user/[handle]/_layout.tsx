// app/apps/mobile/app/user/[handle]/_layout.tsx
// Nested Stack owns the header for /user/[handle]/* routes (parent suppresses
// its header for this group to avoid the doubled-header bug). Mirrors the
// detailHeader styling from the parent _layout so the chrome stays consistent.

import { Stack } from 'expo-router';
import React from 'react';
import { useTheme } from '@kc/ui';
import { nativeStackHeaderLeftIconOnly } from '../../../src/navigation/nativeHeaderIconOnly';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

export default function UserHandleLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        ...nativeStackHeaderLeftIconOnly(colors.primary),
        headerBackVisible: false,
        headerTintColor: colors.primary,
        headerStyle: { backgroundColor: colors.surface },
        headerTitleAlign: 'center',
      }}
    />
  );
}
