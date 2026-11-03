// Floating toast for short feedback (e.g. publish result). Mounted in root shell.
// Mapped to: FR-POST-001 publish feedback (R-MVP-Core-4 Hebrew copy via i18n in callers).

import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeUseStyles, radius, shadow, spacing, typography, useTheme, zIndex, Text } from '@kc/ui';
import { useFeedSessionStore } from '../store/feedSessionStore';

export function EphemeralToast() {
  const styles = useStyles();
  const { colors } = useTheme();
  const toast = useFeedSessionStore((s) => s.ephemeralToast);
  const insets = useSafeAreaInsets();
  if (!toast) return null;

  const backgroundColor = toast.tone === 'success' ? colors.primary : colors.error;

  return (
    <View
      pointerEvents="none"
      style={[styles.wrap, { top: insets.top + spacing.sm }]}
    >
      <View style={[styles.bubble, { backgroundColor }]}>
        <Text style={styles.text}>{toast.message}</Text>
      </View>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  wrap: {
    position: 'absolute',
    start: spacing.base,
    end: spacing.base,
    zIndex: zIndex.toast,
    alignItems: 'center',
  },
  bubble: {
    maxWidth: 420,
    width: '100%',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
    borderRadius: radius.lg,
    // RN-Web + native shadow
    ...shadow.modal,
    shadowColor: colors.shadow,
  },
  text: {
    ...typography.body,
    color: colors.textInverse,
    ...typography.semiBold,
    textAlign: 'center',
  },
}));
