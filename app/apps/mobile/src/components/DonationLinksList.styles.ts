import { makeUseStyles, radius, spacing, typography } from '@kc/ui';
import { rtlTextAlignStart } from '../lib/rtlTextAlignStart';

export const useDonationLinksListStyles = makeUseStyles(({ colors }) => ({
  container: { gap: spacing.md },
  // `row` + parent RTL: title (first child) at inline-start (visual right), + at end.
  // `row-reverse` + native/web RTL quirks pinned the section title to the wrong edge.
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: spacing.sm,
    width: '100%',
  },
  // No title (a parent section titles the list): the add button keeps the row's end.
  headerUntitled: { justifyContent: 'flex-end' as const },
  headerTitle: {
    ...typography.h2,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    flex: 1,
    minWidth: 0,
  },
  plusBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  plusBtnPressed: { opacity: 0.85 },
  list: { gap: spacing.md, paddingBottom: spacing.lg },
  loading: { paddingVertical: spacing.xl, alignItems: 'center' as const },
  empty: {
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center' as const,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed' as const,
  },
  emptyTitle: { ...typography.h3, color: colors.textPrimary, textAlign: 'center' as const },
  emptyBody: { ...typography.body, color: colors.textSecondary, textAlign: 'center' as const },
  emptyCta: { marginTop: spacing.sm },
}));
