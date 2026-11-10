// Native-stack chrome for modal/detail routes (post detail, edit profile, matches).
// Settings, chat inbox, and notifications use `useShellStackScreenOptions` instead.
import React from 'react';
import { Platform } from 'react-native';
import { useTheme } from '@kc/ui';
import { nativeStackHeaderLeftIconOnly } from './nativeHeaderIconOnly';
import { NativeStackHeaderTitle } from './NativeStackHeaderTitle';
import { rootStackGestureEnabled, rootStackScreenAnimation } from './rootStackAnimation';

export function useDetailStackScreenOptions() {
  const { colors } = useTheme();
  return {
    headerShown: true,
    ...nativeStackHeaderLeftIconOnly(colors.primary),
    headerBackVisible: false,
    headerTintColor: colors.primary,
    // Match the in-tabs TopBar: cream bar + `textPrimary` title (not stack default white).
    headerStyle: { backgroundColor: colors.surfaceCream },
    headerTitle: ({ children }: { children: string }) => (
      <NativeStackHeaderTitle title={typeof children === 'string' ? children : ''} />
    ),
    headerTitleAlign: 'center' as const,
    animation: rootStackScreenAnimation(),
    gestureEnabled: rootStackGestureEnabled,
    fullScreenGestureEnabled: Platform.OS === 'ios',
    ...(Platform.OS === 'ios' ? { headerLargeTitle: false } : {}),
  } as const;
}
