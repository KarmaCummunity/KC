// Stack layout for My Profile. `index` holds the profile chrome and both posts lanes;
// `closed` only redirects its legacy URL there; `saved` / `hidden` / `removed` are
// pushed list screens with a standard back header.
// Mapped to: FR-PROFILE-001 AC4, FR-PROFILE-016.
import React from 'react';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@kc/ui';
import { nativeStackHeaderLeftIconOnly } from '../../../src/navigation/nativeHeaderIconOnly';
import { nestedStackGestureOptions } from '../../../src/navigation/nestedStackGestureOptions';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

export default function ProfileTabLayout() {
  const { colors } = useTheme();
  const listScreenHeader = {
    headerShown: true,
    ...nativeStackHeaderLeftIconOnly(colors.primary),
    headerBackVisible: false,
    headerTintColor: colors.primary,
    headerStyle: { backgroundColor: colors.surface },
    headerTitleAlign: 'center' as const,
  } as const;
  const { t } = useTranslation();
  return (
    <Stack screenOptions={{ ...nestedStackGestureOptions, headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="closed" />
      <Stack.Screen
        name="saved"
        options={{
          ...listScreenHeader,
          headerTitle: t('profile.myProfileMenuSavedPosts'),
        }}
      />
      <Stack.Screen
        name="hidden"
        options={{
          ...listScreenHeader,
          headerTitle: t('profile.myProfileMenuHiddenPosts'),
        }}
      />
      <Stack.Screen
        name="removed"
        options={{
          ...listScreenHeader,
          headerTitle: t('profile.myProfileMenuRemovedPosts'),
        }}
      />
    </Stack>
  );
}
