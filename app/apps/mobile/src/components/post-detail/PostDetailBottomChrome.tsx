// Unified dock for post detail: owner CTAs + comment composer share one surface above the tab bar.
import React, { type ReactNode } from 'react';
import { View } from 'react-native';
import { makeUseStyles, shadow, spacing } from '@kc/ui';
import { Platform } from 'react-native';

type Props = Readonly<{
  /** Clears the floating tab bar and centre "+". */
  tabBarOverlayInset: number;
  /** Compact pill CTA (FR-POST-015 AC6) shown above the surface, in flow so it never covers the composer. */
  floatingSlot?: ReactNode;
  ownerSlot?: ReactNode;
  composerSlot?: ReactNode;
}>;

export function PostDetailBottomChrome({ tabBarOverlayInset, floatingSlot, ownerSlot, composerSlot }: Props) {
  const styles = useStyles();
  const hasSurface = Boolean(ownerSlot || composerSlot);
  if (!floatingSlot && !hasSurface) return null;

  return (
    <View
      style={[styles.outer, { paddingBottom: tabBarOverlayInset }]}
      testID="post-detail-bottom-chrome"
      pointerEvents="box-none"
    >
      {floatingSlot ? (
        <View style={styles.floatingRow} pointerEvents="box-none">
          {floatingSlot}
        </View>
      ) : null}
      {hasSurface ? (
        <View style={styles.surface} pointerEvents="auto">
          {ownerSlot ? <View style={styles.ownerBlock}>{ownerSlot}</View> : null}
          {composerSlot ? <View style={composerSlot && ownerSlot ? styles.composerBlock : undefined}>{composerSlot}</View> : null}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors, isDark }) => ({
  outer: {
    ...(Platform.OS === 'web' ? {} : { width: '100%' }),
  },
  floatingRow: {
    alignItems: 'center',
    paddingBottom: spacing.sm,
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
