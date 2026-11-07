// Unified dock for post detail: owner CTAs + comment composer share one surface above the tab bar.
import React, { type ReactNode } from 'react';
import { View } from 'react-native';
import { makeUseStyles, shadow, spacing } from '@kc/ui';
import { Platform } from 'react-native';

type Props = Readonly<{
  /** Clears the floating tab bar and centre "+". */
  tabBarOverlayInset: number;
  ownerSlot?: ReactNode;
  composerSlot?: ReactNode;
}>;

export function PostDetailBottomChrome({ tabBarOverlayInset, ownerSlot, composerSlot }: Props) {
  const styles = useStyles();
  if (!ownerSlot && !composerSlot) return null;

  return (
    <View
      style={[styles.outer, { paddingBottom: tabBarOverlayInset }]}
      testID="post-detail-bottom-chrome"
      pointerEvents="box-none"
    >
      <View style={styles.surface} pointerEvents="auto">
        {ownerSlot ? <View style={styles.ownerBlock}>{ownerSlot}</View> : null}
        {composerSlot ? <View style={composerSlot && ownerSlot ? styles.composerBlock : undefined}>{composerSlot}</View> : null}
      </View>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors, isDark }) => ({
  outer: {
    ...(Platform.OS === 'web' ? {} : { width: '100%' }),
  },
  surface: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    ...shadow.modal,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: -shadow.modal.shadowOffset.height },
    shadowOpacity: isDark ? shadow.modal.shadowOpacity : shadow.card.shadowOpacity,
  },
  ownerBlock: {
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.xs,
  },
  composerBlock: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
  },
}));
