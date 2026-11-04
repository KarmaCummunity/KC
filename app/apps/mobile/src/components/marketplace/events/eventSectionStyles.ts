// Shared styles of an organization event's post-page section: the details card, the viewer's
// registration and the organizer's roster (G1 step 5).
import { makeUseStyles, radius, spacing, typography } from '@kc/ui';

export const useEventSectionStyles = makeUseStyles(({ colors }) => ({
  box: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceRaised },
  caption: { ...typography.caption, color: colors.textSecondary },
  line: { ...typography.body, color: colors.textPrimary },
  row: { gap: spacing.xs, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  name: { ...typography.bodyLarge, color: colors.textPrimary },
  actions: { flexDirection: 'row' as const, gap: spacing.sm, flexWrap: 'wrap' as const },
}));
