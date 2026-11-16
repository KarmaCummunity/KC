// Pure redirect decision of `AuthGate`, kept free of expo-router so it is unit-testable.
// Mapped to spec: FR-AUTH-001 AC4, FR-AUTH-007 AC2, FR-AUTH-013 (Sentry KC-9).
import { isSignedOutSurface } from './signedOutSurfaces';

export interface AuthRedirectInput {
  /** expo-router's root navigation state exists; navigating earlier throws (Android activity recreation). */
  readonly navigationReady: boolean;
  readonly isLoading: boolean;
  readonly isAuthenticated: boolean;
  readonly segments: readonly string[];
  readonly pathname: string;
  readonly onboardingState: 'pending_basic_info' | 'pending_avatar' | 'completed' | null;
  readonly basicInfoSkipped: boolean | null;
}

export type AuthRedirect =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'replace';
      /** `null` means "the remembered deep link, else the tabs" (`usePendingPath`). */
      readonly href: string | null;
      readonly rememberPath?: string;
      readonly usePendingPath?: true;
    };

const NONE: AuthRedirect = { kind: 'none' };

export function decideAuthRedirect(i: AuthRedirectInput): AuthRedirect {
  if (!i.navigationReady || i.isLoading) return NONE;
  if (!i.isAuthenticated) {
    if (isSignedOutSurface(i.segments, i.pathname)) return NONE;
    // FR-POST-023 AC6 — remember the deep-link target for after sign-in.
    return { kind: 'replace', href: '/(auth)', rememberPath: i.pathname };
  }
  // Only the entry routes (welcome group, OAuth return, email verification) forward a signed-in member.
  const inAuthGroup = i.segments[0] === '(auth)';
  const isAuthReturn = i.segments[0] === 'auth' && (i.segments[1] === 'callback' || i.segments[1] === 'verify');
  if (!inAuthGroup && !isAuthReturn) return NONE;
  if (i.onboardingState === null) return NONE;
  if (i.onboardingState === 'pending_basic_info' && i.basicInfoSkipped !== true) {
    return { kind: 'replace', href: '/(onboarding)/about-intro' };
  }
  if (i.onboardingState === 'pending_avatar') return { kind: 'replace', href: '/(onboarding)/photo' };
  return { kind: 'replace', href: null, usePendingPath: true };
}
