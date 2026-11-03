// app/apps/mobile/src/components/admin/admins/roleErrors.ts
// FR-ADMIN-016 / FR-ADMIN-030 — user-visible text for role grant/change errors.
import type { LocaleBundle } from '../../../i18n/useLocaleBundle';

type GrantErrors = LocaleBundle['admin']['admins']['grantModal']['errors'];

/** Localized message for an `AdminRoleError` code; unknown codes fall back. */
export function roleScopeErrorText(L: LocaleBundle, code: string): string {
  const errors: GrantErrors = L.admin.admins.grantModal.errors;
  return code in errors ? errors[code as keyof GrantErrors] : errors.unknown;
}
