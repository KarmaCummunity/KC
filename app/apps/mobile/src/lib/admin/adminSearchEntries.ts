// FR-ADMIN-011 / #2081 — full admin-portal search registry: nav screens plus settings and
// dashboard actions. Screens stay in ADMIN_DESTINATIONS (shared with the rail); extras here are
// search-only so the rail stays one entry per section.
import { ADMIN_DESTINATIONS, type AdminDestination } from './adminDestinations';

/** One searchable admin entry (screen, setting, or action). Same RBAC shape as a nav destination. */
export type AdminSearchEntry = AdminDestination;

/** Finance settings + the onboarding-replay action — reachable from search, not duplicated on the rail. */
const ADMIN_SEARCH_EXTRAS: readonly AdminSearchEntry[] = [
  { key: 'moneyAccounts', href: '/(admin)/money/accounts', icon: 'card-outline', perm: 'money.view' },
  { key: 'moneyDonors', href: '/(admin)/money/donors', icon: 'heart-outline', perm: 'money.transparency' },
  { key: 'moneyVisibility', href: '/(admin)/money/visibility', icon: 'eye-outline', perm: 'money.view' },
  // FR-ADMIN-035 — every portal admin may replay onboarding; the search result starts the sandbox.
  { key: 'onboardingReplay', href: '/(onboarding)/about-intro', icon: 'refresh-circle-outline', perm: null },
];

/** Static registry the dashboard search filters (screens + settings + actions). */
export const ADMIN_SEARCH_ENTRIES: readonly AdminSearchEntry[] = [
  ...ADMIN_DESTINATIONS,
  ...ADMIN_SEARCH_EXTRAS,
];

/** True for dashboard actions that prepare state before navigation. */
export function isAdminSearchAction(key: string): boolean {
  return key === 'onboardingReplay';
}
