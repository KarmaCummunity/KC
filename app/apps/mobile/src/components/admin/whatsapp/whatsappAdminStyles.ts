// Shared look of the admin WhatsApp console panels (#939).
import { makeUseStyles, radius, spacing, typography } from '@kc/ui';
import { isWhatsAppAdminError } from '@kc/domain';
import type { LocaleBundle } from '../../../i18n/useLocaleBundle';

export const useWhatsAppAdminStyles = makeUseStyles(({ colors }) => ({
  section: {
    marginTop: spacing.base, marginBottom: spacing.xs, fontSize: typography.bodyLarge.fontSize,
    ...typography.bold, color: colors.textPrimary,
  },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1,
    borderColor: colors.border, gap: spacing.sm,
  },
  cardTitle: { ...typography.bold, color: colors.textPrimary },
  muted: { color: colors.textSecondary, fontSize: typography.bodySmall.fontSize },
  error: { color: colors.error, fontSize: typography.bodySmall.fontSize },
  btn: { marginTop: spacing.xs, alignSelf: 'flex-start' },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  kpi: {
    width: '30%', minWidth: 96, backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  kpiValue: { fontSize: typography.h3.fontSize, ...typography.bold, color: colors.textPrimary },
  kpiLabel: { fontSize: typography.caption.fontSize, color: colors.textSecondary },
  row: {
    backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.xs,
    borderWidth: 1, borderColor: colors.border, gap: spacing.xs,
  },
  rowTitle: { ...typography.semiBold, color: colors.textPrimary },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  linkBtn: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
  link: { color: colors.primary, ...typography.semiBold },
  linkDanger: { color: colors.error, ...typography.semiBold },
}));

type WhatsAppCopy = LocaleBundle['admin']['whatsapp'];

/** The message to show for a failed console action. */
export function whatsappAdminErrorText(t: WhatsAppCopy, error: unknown): string | null {
  if (!error) return null;
  if (isWhatsAppAdminError(error)) return t.errors[error.code] ?? t.errorGeneric;
  return t.errorGeneric;
}
