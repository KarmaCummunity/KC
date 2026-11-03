import { makeUseStyles, spacing, typography } from '@kc/ui';

export const useMapExplorerStyles = makeUseStyles(({ colors }) => ({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { ...typography.h2, color: colors.textPrimary },
  toggle: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 2 },
  toggleBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  toggleBtnActive: { backgroundColor: colors.primary },
  toggleText: { ...typography.caption, color: colors.textPrimary, fontWeight: '600' },
  toggleTextActive: { color: colors.textInverse },
  chipsBar: { flexGrow: 0 },
  chips: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { ...typography.caption, color: colors.textPrimary, fontWeight: '600' },
  chipTextActive: { color: colors.textInverse },
  mapWrap: { flex: 1, overflow: 'hidden' },
  searchArea: {
    position: 'absolute', top: 12, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
  searchAreaText: { ...typography.caption, color: colors.textInverse, fontWeight: '700' },
  loader: { position: 'absolute', top: 16, alignSelf: 'center' },
  emptyPill: {
    position: 'absolute', top: 60, alignSelf: 'center', backgroundColor: colors.surface, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: colors.border,
  },
  emptyText: { ...typography.caption, color: colors.textSecondary },
  fab: {
    position: 'absolute', end: 16, width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
  notice: {
    position: 'absolute', start: 16, end: 76, backgroundColor: colors.surface, borderRadius: 12, padding: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  noticeText: { ...typography.caption, color: colors.textSecondary },
  sheet: {
    position: 'absolute', start: 0, end: 0, bottom: 0, backgroundColor: colors.background,
    borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 10,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: -2 }, elevation: 8,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingBottom: 6 },
  sheetTitle: { ...typography.bodyLarge, color: colors.textPrimary, fontWeight: '700' },
  sheetCards: { paddingHorizontal: spacing.md, gap: spacing.md },
  listHeader: { ...typography.caption, color: colors.textSecondary, padding: spacing.md },
  listEmpty: { ...typography.body, color: colors.textSecondary, padding: spacing.lg, textAlign: 'center' },
}));
