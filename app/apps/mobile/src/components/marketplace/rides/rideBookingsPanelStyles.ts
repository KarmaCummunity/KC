// Styles of the driver's passenger list on the ride screen (card, seat meter, passenger cards).
import { makeUseStyles, radius, shadow, spacing, typography, type ColorPalette } from '@kc/ui';
import type { RideBookingListStatus } from '@kc/domain';
import { rowDirectionStart, selfAlignStart, textAlignStart } from '../../../lib/rtlLayout';

const textStart = () => ({ textAlign: textAlignStart(), alignSelf: selfAlignStart });

export const useRideBookingsPanelStyles = makeUseStyles(({ colors, isDark }) => ({
  card: {
    gap: spacing.md,
    padding: spacing.base,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignSelf: 'stretch',
    width: '100%',
    ...shadow.card,
  },
  header: { flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.md },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.primarySurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, gap: spacing.xs / 2 },
  title: { ...typography.h3, color: colors.textPrimary, ...textStart() },
  caption: { ...typography.caption, color: colors.textSecondary, ...textStart() },
  meter: { flexDirection: rowDirectionStart, gap: spacing.xs, alignSelf: 'stretch' },
  meterSegment: { flex: 1, height: 6, borderRadius: radius.full },
  notice: {
    flexDirection: rowDirectionStart,
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.warningLight,
  },
  noticeText: { ...typography.caption, color: colors.textPrimary, flex: 1, textAlign: textAlignStart() },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
  },
  emptyText: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
  list: { gap: spacing.sm, alignSelf: 'stretch' },
  passenger: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: isDark ? colors.surfaceRaised : colors.background,
    alignSelf: 'stretch',
  },
  passengerMuted: { opacity: 0.7 },
  passengerHead: { flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.md },
  passengerText: { flex: 1, gap: spacing.xs },
  name: { ...typography.bodyLarge, ...typography.semiBold, color: colors.textPrimary, ...textStart() },
  metaRow: { flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  meta: { flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.xs },
  metaText: { ...typography.caption, color: colors.textSecondary },
  pill: {
    flexDirection: rowDirectionStart,
    alignItems: 'center',
    gap: spacing.xs + spacing.xs / 2,
    paddingVertical: spacing.xs / 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
  },
  pillDot: { width: 6, height: 6, borderRadius: radius.full },
  pillText: { ...typography.caption, ...typography.semiBold, color: colors.textPrimary },
  chatBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoLine: { flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.xs },
  infoText: { ...typography.caption, color: colors.textSecondary, flex: 1, textAlign: textAlignStart() },
  warningText: { ...typography.caption, color: colors.error, flex: 1, textAlign: textAlignStart() },
  actions: { flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.sm, alignSelf: 'stretch' },
}));

/** Status pill colours: a soft background with a solid dot, text stays `textPrimary` for AA. */
export function statusTone(status: RideBookingListStatus, colors: ColorPalette): { bg: string; dot: string } {
  switch (status) {
    case 'reserved':
      return { bg: colors.warningLight, dot: colors.warning };
    case 'confirmed':
      return { bg: colors.successLight, dot: colors.success };
    case 'handed_over':
      return { bg: colors.primarySurface, dot: colors.primary };
    default:
      return { bg: colors.skeleton, dot: colors.textDisabled };
  }
}
