// Styles for /(tabs)/search.tsx. Extracted so the screen file stays under the
// architecture file-size budget. The search bar and filter button use shared filterKit.
import { StyleSheet } from 'react-native';
import { makeUseStyles, radius, spacing, typography } from '@kc/ui';
import { rtlTextAlignEnd, rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { layoutDirectionStyle, rowDirectionStart } from '../../lib/rtlLayout';

export const useSearchScreenStyles = makeUseStyles(({ colors }) => ({
  container: { flex: 1, backgroundColor: colors.surfaceCream },

  // ── Search bar + filter button ────────────────────────────────────────
  searchRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  searchBarWrap: { flex: 1, marginBottom: 0 },
  searchBarRow: {
    height: 52,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.base,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },

  // ── Category / sort chips ─────────────────────────────────────────────
  chipContainer: { backgroundColor: 'transparent', maxHeight: 52 },
  chipRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  chipDivider: {
    width: 1,
    height: 24,
    backgroundColor: colors.border,
    marginHorizontal: spacing.xs,
  },
  chipRefresh: {
    justifyContent: 'center' as const,
    paddingHorizontal: spacing.xs,
  },

  // ── Content + sections ────────────────────────────────────────────────
  content: { flex: 1 },
  contentInner: { padding: spacing.base, paddingBottom: spacing['2xl'] },
  section: { marginBottom: spacing.lg },
  sectionHeader: {
    flexDirection: rowDirectionStart,
    ...layoutDirectionStyle(),
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: spacing.sm,
  },
  sectionTitleRow: {
    flexDirection: rowDirectionStart,
    ...layoutDirectionStyle(),
    alignItems: 'center' as const,
    gap: spacing.xs,
    flexShrink: 1,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
  },
  sectionCount: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
  },
  showAllBtn: { flexShrink: 0 },
  showAllText: {
    ...typography.caption,
    ...typography.semiBold,
    color: colors.primary,
    textAlign: rtlTextAlignEnd,
  },

  // ── Recent searches ───────────────────────────────────────────────────
  recentRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  recentRowPressed: { backgroundColor: colors.background },
  recentText: { flex: 1, ...typography.body, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  clearRecentText: {
    ...typography.caption,
    ...typography.medium,
    color: colors.error,
    textAlign: rtlTextAlignEnd,
  },

  // ── Empty / loading states ────────────────────────────────────────────
  emptyState: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: spacing['3xl'],
    gap: spacing.md,
  },
  emptyTitle: { ...typography.h3, color: colors.textPrimary, textAlign: 'center' as const },
  emptySubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center' as const,
    maxWidth: 260,
  },
  loadingWrap: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: spacing['3xl'],
    gap: spacing.md,
  },
  loadingText: { ...typography.body, color: colors.textSecondary },

  // ── National links note ───────────────────────────────────────────────
  nationalNote: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'flex-end' as const,
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  nationalNoteText: { ...typography.caption, color: colors.textSecondary, fontStyle: 'italic' as const },
}));
