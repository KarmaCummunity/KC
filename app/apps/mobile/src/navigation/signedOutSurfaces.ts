// The routes a signed-out visitor may stay on. Everything else is a member route: `AuthGate`
// remembers it as the post-sign-in target and sends the visitor to the welcome screen.
//
// Signed-out access is minimal by decision (docs/db/target-design.md §12.1): the sign-in flow, the
// published legal text, the About pages, the public research form and public nonprofit pages.
// There is no guest feed and no signed-out post preview. Pure: no expo-router import.
import { isPublicLegalSegment } from './publicLegalPaths';
import { isPublicOrgPagePath } from './publicOrgPaths';
import { isPublicResearchPath } from './publicResearchPaths';

/**
 * Routes under `/auth` that a link opens before a session exists: the OAuth return
 * (FR-AUTH-003), the email-verification landing (FR-AUTH-006) and the password reset (FR-AUTH-008).
 */
const SIGNED_OUT_AUTH_ROUTES: ReadonlySet<string> = new Set(['callback', 'verify', 'reset-password']);

/**
 * Top-level routes open without a session: the terminal blocked-account screen (FR-MOD-010 AC4),
 * the About pages and the public research form (FR-RESEARCH-001 AC2).
 */
const SIGNED_OUT_ROOT_ROUTES: ReadonlySet<string> = new Set([
  '(auth)',
  'account-blocked',
  'about',
  'about-site',
  'research',
]);

/** True when the route (`segments` of the matched route, `pathname` as shown) needs no session. */
export function isSignedOutSurface(segments: readonly string[], pathname: string): boolean {
  const [head, child] = segments;
  if (head === undefined) return false;
  if (SIGNED_OUT_ROOT_ROUTES.has(head)) return true;
  if (head === 'auth') return child !== undefined && SIGNED_OUT_AUTH_ROUTES.has(child);
  return isPublicLegalSegment(segments) || isPublicResearchPath(pathname) || isPublicOrgPagePath(pathname);
}
