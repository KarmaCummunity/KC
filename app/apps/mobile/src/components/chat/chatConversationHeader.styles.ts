// Styles for `ChatConversationHeader.tsx` (kept out of `app/` so `src/` does not import `app/`).
import { StyleSheet } from 'react-native';
import { makeUseStyles, typography, spacing, zIndex, shadow } from '@kc/ui';
import { rowDirectionStart } from '../../lib/rtlLayout';

export const useChatConversationHeaderStyles = makeUseStyles(({ colors }) => ({
  wrap: {
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    zIndex: zIndex.overlay,
    ...shadow.card,
  },
  row: {
    // Back affordance at the reading-start edge, actions menu at the end (both directions).
    flexDirection: rowDirectionStart,
    alignItems: 'stretch',
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  side: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, maxWidth: '100%' },
  title: { ...typography.h3, color: colors.textPrimary, flexShrink: 1 },
}));
