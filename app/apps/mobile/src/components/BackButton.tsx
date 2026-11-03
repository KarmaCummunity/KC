// Single source of truth for the "back" affordance on every detail-screen
// header. Replaces the native auto back button (suppressed via
// `headerBackVisible: false` at the Stack.Screen level) so it's always
// rendered consistently across iOS RTL, Android, and web.
import React from 'react';
import { Pressable } from 'react-native';
import { router } from 'expo-router';
import { iconSize, spacing } from '@kc/ui';
import i18n from '../i18n';
import { MirroredIcon, useDirectionalBackIcon } from './ui/MirroredIcon';

/** Native-stack header views may mount outside the main tree, so `useTranslation()` has no context. */
export function BackButton({ tintColor }: Readonly<{ tintColor: string }>) {
  const backIcon = useDirectionalBackIcon();
  const onPress = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)');
  };
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={i18n.t('general.back')}
      style={{ paddingHorizontal: spacing.sm }}
    >
      <MirroredIcon name={backIcon} size={iconSize['2xl']} color={tintColor} />
    </Pressable>
  );
}
