// Visible warning shown at the top of every screen.
//
// Trigger paths:
//   1. EXPO_PUBLIC_ENVIRONMENT === 'development' — any client bundle (e.g.
//      Railway dev web) built with that env baked in.
//   2. Metro dev bundle (__DEV__) — local `expo start` without duplicating
//      the env var still shows the generic DEV strip.
//   3. __DEV__ ghost session / auto-sign-in — extra copy when those
//      shortcuts are enabled.
// All strips use the same styling so the warning is recognizable.
import React from 'react';
import { Pressable, View } from 'react-native';
import { makeUseStyles, spacing, typography, useTheme, Text } from '@kc/ui';
import { useTranslation } from 'react-i18next';
import { isDevGhostSessionEnabled } from '../services/devGhostSession';
import { isDevAutoSignInEnabled } from '../services/devAutoSignIn';
import { isDevEnvironment } from '../config/environment';

export function DevBanner() {
  const styles = useStyles();
  const { t } = useTranslation();
  const envDev = isDevEnvironment();
  const metroDev = typeof __DEV__ !== 'undefined' && __DEV__;
  const ghost = metroDev && isDevGhostSessionEnabled();
  const auto = metroDev && isDevAutoSignInEnabled();

  if (!envDev && !metroDev) return null;

  // Priority: explicit dev shortcuts > env signal (devs already know they're
  // local; the shortcut warning is more actionable).
  const label = ghost
    ? 'DEV GHOST SESSION — fake JWT, Supabase queries will 401'
    : auto
    ? 'DEV AUTO SIGN-IN — real test user'
    : t('devBanner');

  return (
    <View style={styles.bar} pointerEvents="box-none">
      <Pressable style={styles.inner} accessibilityRole="text">
        <Text style={styles.text}>{label}</Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  bar: {
    position: 'absolute',
    top: 0,
    start: 0,
    end: 0,
    zIndex: 9999, // brand-guard-allow: global development banner overlay
    backgroundColor: colors.error,
  },
  inner: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    alignItems: 'center',
  },
  text: {
    color: colors.textInverse,
    ...typography.caption,
    ...typography.semiBold,
    letterSpacing: 0.3,
  },
}));
