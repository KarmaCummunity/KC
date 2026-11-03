// WebRefreshButton — refresh affordance for web (FR-FEED-010 AC2). Renders
// only on web; native platforms use the KcFlashList's RefreshControl instead.
// Also wires the global "R" keyboard shortcut while the feed is mounted.
// Home feed passes an async onPress that shows success/error EphemeralToast when done.

import React, { useEffect } from 'react';
import { Platform, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { iconSize, makeUseStyles, spacing, useTheme } from '@kc/ui';
interface WebRefreshButtonProps {
  onPress: () => void;
  isLoading: boolean;
}

export function WebRefreshButton({ onPress, isLoading }: WebRefreshButtonProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  // R-key shortcut. Only attaches on web — and only fires when no input is
  // focused so we never hijack a typing user.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'r' && e.key !== 'R') return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isEditable =
        tag === 'input' || tag === 'textarea' || (target?.isContentEditable ?? false);
      if (isEditable || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      onPress();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onPress]);

  if (Platform.OS !== 'web') return null;

  return (
    <TouchableOpacity
      style={styles.btn}
      onPress={onPress}
      disabled={isLoading}
      accessibilityLabel={t('feed.refreshA11y')}
    >
      <Ionicons
        name="refresh-outline"
        size={iconSize.xl}
        color={isLoading ? colors.textDisabled : colors.textPrimary}
      />
    </TouchableOpacity>
  );
}

const useStyles = makeUseStyles(() => ({
  btn: { padding: spacing.xs },
}));