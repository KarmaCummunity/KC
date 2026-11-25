// The routes a signed-out visitor may stay on. Everything else is a member route: `AuthGate`
// either remaps guest-readable content (`guestReadableRedirect`) or remembers the path and
// sends the visitor to the welcome screen.
//
// Signed-out access (docs/db/target-design.md §12.1, D186 + guest read-only expansion):
// the sign-in flow, published legal text, About pages, public research, nonprofit pages, and
// `/browse` (+ `/browse/post/<uuid>`). Member map and other-user profile routes stay gated until
// anon RPCs exist. Pure: no expo-router import.
import { isGuestBrowsePath } from './guestBrowsePaths';
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
  if (head === 'browse') return isGuestBrowsePath(pathname);
  if (head === undefined) return false;
  if (SIGNED_OUT_ROOT_ROUTES.has(head)) return true;
  if (head === 'auth') return child !== undefined && SIGNED_OUT_AUTH_ROUTES.has(child);
  return isPublicLegalSegment(segments) || isPublicResearchPath(pathname) || isPublicOrgPagePath(pathname);
}
