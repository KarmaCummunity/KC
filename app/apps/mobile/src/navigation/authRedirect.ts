// Where the auth gate sends the visitor, as a pure decision (no expo-router import).
// `AuthGate` feeds it the store and route state and performs the navigation it returns.
// Mapped to spec: FR-AUTH-001 AC4, FR-AUTH-007 AC2, FR-AUTH-010 AC3, FR-AUTH-013.
import type { OnboardingState } from '@kc/domain';
import { isSignedOutSurface } from './signedOutSurfaces';

export interface AuthRedirectInput {
  /**
   * The root navigator is mounted. Navigating before that throws inside expo-router; it is false
   * in the first commit after Android recreates the activity, when the store is already loaded.
   */
  readonly navigationReady: boolean;
  /** The cold-start session restore has not finished. */
  readonly isLoading: boolean;
  readonly isAuthenticated: boolean;
  /** Null until the bootstrap read after sign-in. */
  readonly onboardingState: OnboardingState | null;
  readonly basicInfoSkipped: boolean | null;
  /** Segments of the matched route. */
  readonly segments: readonly string[];
  /** The path as shown, or null when the router has none yet. */
  readonly pathname: string | null;
}

export type AuthRedirect =
  /** No navigation. */
  | { readonly kind: 'stay' }
  /** Signed out on a member route: open the welcome screen, and come back to `rememberPath` after sign-in. */
  | { readonly kind: 'welcome'; readonly rememberPath: string | null }
  /** Signed in with an onboarding step left. */
  | { readonly kind: 'onboarding'; readonly href: '/(onboarding)/about-intro' | '/(onboarding)/photo' }
  /** Signed in and done: the remembered path if there is one, else the tabs. */
  | { readonly kind: 'home' };

const STAY: AuthRedirect = { kind: 'stay' };

/**
 * Entry routes: where a visitor is while a session is being created. Only these forward a signed-in
 * member onward. Everywhere else the member stays, so the FR-AUTH-015 soft gate handles a pending
 * step (redirecting from the tabs back to onboarding would loop after the FR-AUTH-010 AC3 skip).
 */
function isEntryRoute(segments: readonly string[]): boolean {
  const [head, child] = segments;
  return head === '(auth)' || (head === 'auth' && (child === 'callback' || child === 'verify'));
}

/** The navigation the auth gate should perform for the current store and route state. */
export function resolveAuthRedirect(input: AuthRedirectInput): AuthRedirect {
  if (!input.navigationReady || input.isLoading) return STAY;

  if (!input.isAuthenticated) {
    if (isSignedOutSurface(input.segments, input.pathname ?? '')) return STAY;
    return { kind: 'welcome', rememberPath: input.pathname };
  }

  if (!isEntryRoute(input.segments) || input.onboardingState === null) return STAY;
  if (input.onboardingState === 'pending_avatar') return { kind: 'onboarding', href: '/(onboarding)/photo' };
  if (input.onboardingState === 'pending_basic_info' && input.basicInfoSkipped !== true) {
    return { kind: 'onboarding', href: '/(onboarding)/about-intro' };
  }
  return { kind: 'home' };
}
