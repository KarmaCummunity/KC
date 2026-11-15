// app/apps/mobile/src/components/admin/admins/roleErrors.ts
// FR-ADMIN-016 / FR-ADMIN-030 — user-visible text for role grant/change/revoke errors.
import { isAdminRoleError } from '@kc/domain';
import type { LocaleBundle } from '../../../i18n/useLocaleBundle';
import { isBackendUnavailable, notAvailableMessage } from '../../../lib/backendAvailability';

type GrantErrors = LocaleBundle['admin']['admins']['grantModal']['errors'];

/** Marks a role action whose backend object is not deployed (degrade rule). */
export const BACKEND_UNAVAILABLE_CODE = 'backend_unavailable';

/** The error code a role action ended in: the server's reason, "unavailable", or `unknown`. */
export function roleErrorCode(error: unknown): string {
  if (isAdminRoleError(error)) return error.code;
  return isBackendUnavailable(error) ? BACKEND_UNAVAILABLE_CODE : 'unknown';
}

/** Localized message for an `AdminRoleError` code; unknown codes fall back. */
export function roleScopeErrorText(L: LocaleBundle, code: string): string {
  if (code === BACKEND_UNAVAILABLE_CODE) return notAvailableMessage();
  const errors: GrantErrors = L.admin.admins.grantModal.errors;
  return code in errors ? errors[code as keyof GrantErrors] : errors.unknown;
}
