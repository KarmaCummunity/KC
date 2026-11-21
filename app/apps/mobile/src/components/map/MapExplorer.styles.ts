import { makeUseStyles, radius, spacing, typography } from '@kc/ui';

export const useMapExplorerStyles = makeUseStyles(({ colors }) => ({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 }, // brand-guard-allow: 6px gap is between spacing.xs and spacing.sm
  title: { ...typography.h2, color: colors.textPrimary },
  toggle: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 2 }, // brand-guard-allow: 18px/2px toggle track is off the radius and spacing scales
  toggleBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.lg }, // brand-guard-allow: 6px vertical padding is between spacing.xs and spacing.sm
  toggleBtnActive: { backgroundColor: colors.primary },
  toggleText: { ...typography.caption, color: colors.textPrimary, ...typography.semiBold },
  toggleTextActive: { color: colors.textInverse },
  chipsBar: { flexGrow: 0 },
  chips: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  categoryChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 7, // brand-guard-allow: 6px/7px chip padding is off the spacing scale
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  dot: { width: 8, height: 8, borderRadius: radius.xs },
  categoryChipText: { ...typography.caption, color: colors.textPrimary, ...typography.semiBold },
  categoryChipTextActive: { color: colors.textInverse },
  mapWrap: { flex: 1, overflow: 'hidden' },
  searchArea: {
    position: 'absolute', top: 12, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, // brand-guard-allow: 6px gap is between spacing.xs and spacing.sm
    backgroundColor: colors.primary, paddingHorizontal: spacing.base, paddingVertical: 9, borderRadius: 20, // brand-guard-allow: 9px/20px search-area padding and radius are off the scales
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4, // brand-guard-allow: map search-area lift is stronger than shadow.card and not the brand glow
  },
  searchAreaText: { ...typography.caption, color: colors.textInverse, ...typography.bold },
  loader: { position: 'absolute', top: 16, alignSelf: 'center' },
  emptyPill: {
    position: 'absolute', top: 60, alignSelf: 'center', backgroundColor: colors.surface, borderRadius: 14, // brand-guard-allow: 14px pill radius sits between radius.md and radius.lg
    paddingHorizontal: 14, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border, // brand-guard-allow: 14px horizontal padding sits between spacing.md and spacing.base
  },
  emptyText: { ...typography.caption, color: colors.textSecondary },
  fab: {
    position: 'absolute', end: spacing.base, width: 48, height: 48, borderRadius: radius.xl, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4, // brand-guard-allow: map FAB lift is stronger than shadow.card and not the brand glow
  },
  notice: {
    position: 'absolute', start: spacing.base, end: 76, backgroundColor: colors.surface, borderRadius: radius.md, padding: 10, // brand-guard-allow: 10px notice padding sits between spacing.sm and spacing.md
    borderWidth: 1, borderColor: colors.border,
  },
  noticeText: { ...typography.caption, color: colors.textSecondary },
  sheet: {
    position: 'absolute', start: 0, end: 0, bottom: 0, backgroundColor: colors.background,
    borderTopStartRadius: 20, borderTopEndRadius: 20, paddingTop: 10, // brand-guard-allow: 20px/10px sheet radius and padding are off the scales
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: -2 }, elevation: 8, // brand-guard-allow: map sheet lifts upward, unlike shadow.modal
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingBottom: 6 }, // brand-guard-allow: 6px header padding is between spacing.xs and spacing.sm
  sheetTitle: { ...typography.bodyLarge, color: colors.textPrimary, ...typography.bold },
  sheetCards: { paddingHorizontal: spacing.md, gap: spacing.md },
  listHeader: { ...typography.caption, color: colors.textSecondary, padding: spacing.md },
  listEmpty: { ...typography.body, color: colors.textSecondary, padding: spacing.lg, textAlign: 'center' },
}));
