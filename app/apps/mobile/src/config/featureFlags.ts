// Feature flags: compiled defaults + optional remote override (public.app_flags, 0403).
// A remote row wins when present; otherwise (no row, offline, still loading) the default applies.

export const FEATURE_FLAG_DEFAULTS = {
  /** iOS only: false → donation flows open in Safari (App Store 3.2.2(iv)). One-line switch. */
  ios_in_app_donations: false,
  /** Pro paywall screen (/pro). Off until App Store products + price exist. */
  pro_paywall: false,
  /**
   * Money hub: in-app donations to verified nonprofits (#850, roadmap phase 2).
   * Runs on the sandbox provider only, so it stays off until a real provider ships;
   * flip per environment via `public.app_flags` (key `money_in_app_org_payments`).
   */
  money_in_app_org_payments: false,
  /**
   * Read-time machine translation of user content (FR-TRANSLATE-003). Off for now;
   * flip via `public.app_flags` (key `ugc_auto_translation`).
   */
  ugc_auto_translation: false,
} as const satisfies Record<string, boolean>;

export type FeatureFlagKey = keyof typeof FEATURE_FLAG_DEFAULTS;
export type RemoteFeatureFlags = Partial<Record<string, boolean>>;

export function resolveFeatureFlag(key: FeatureFlagKey, remote: RemoteFeatureFlags | undefined): boolean {
  const value = remote?.[key];
  return typeof value === 'boolean' ? value : FEATURE_FLAG_DEFAULTS[key];
}

/** iOS with in-app donations off → hand the donation to the external browser. */
export function shouldOpenDonationsExternally(platformOS: string, iosInAppDonations: boolean): boolean {
  return platformOS === 'ios' && !iosInAppDonations;
}

export type ExternalDonationKind = 'donate' | 'standing-order';

export function buildExternalDonationUrl(
  baseUrl: string,
  kind: ExternalDonationKind,
  orgId: string,
  listingId?: string | null,
): string {
  let base = baseUrl;
  while (base.endsWith('/')) base = base.slice(0, -1);
  const path = `${base}/donations/money/${kind}/${encodeURIComponent(orgId)}`;
  return kind === 'donate' && listingId ? `${path}?listingId=${encodeURIComponent(listingId)}` : path;
}

export function webBaseUrl(): string {
  return process.env['EXPO_PUBLIC_WEB_BASE_URL'] ?? 'https://karma-community-kc.com';
}
