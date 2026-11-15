// Pure routing decisions for tapped push notifications (TD-119 / TD-3).
//
// Kept free of expo-router / expo-notifications / react-native imports so it is
// unit-testable under the node vitest env; `tapHandler.ts` wires these decisions
// to the router and the notification listeners.
import type { PushData, OnboardingState } from '@kc/domain';
import { resolveNotificationRoute, type ResolvedRoute } from './notificationRoutes';
import { isRestorablePath } from '../../store/redirectIntentStore';

export type { ResolvedRoute };

export type TapAuthState = {
  isAuthenticated: boolean;
  isLoading: boolean;
  onboardingState: OnboardingState | null;
};

export type TapAction =
  | { kind: 'push'; route: ResolvedRoute }
  | { kind: 'defer'; route: ResolvedRoute; restorePath: string | null }
  | { kind: 'drop' };

/**
 * A deep-link navigation only sticks once the session has restored and
 * onboarding is complete. During cold start the app sits on the AuthGate splash
 * (`isLoading`) or is about to be bounced to `(auth)` / `(onboarding)`, so an
 * eager push loses the race to AuthGate's redirect and the target is dropped.
 * TD-119 / TD-3.
 */
export function isReadyToRoute(auth: TapAuthState): boolean {
  return auth.isAuthenticated && !auth.isLoading && auth.onboardingState === 'completed';
}

/**
 * Expand a route template (`/chat/[id]` + `{ id }`) into a concrete path
 * (`/chat/<id>`). Done segment-by-segment rather than with a regex to keep the
 * function free of any backtracking-sensitive pattern.
 */
export function toConcretePath(route: ResolvedRoute): string {
  return route.pathname
    .split('/')
    .map((segment) =>
      segment.startsWith('[') && segment.endsWith(']')
        ? route.params[segment.slice(1, -1)] ?? ''
        : segment,
    )
    .join('/');
}

/**
 * Decide how to handle a tapped notification:
 *  - `drop`  — the payload is not a notification.
 *  - `push`  — the app is ready; navigate now.
 *  - `defer` — the app is not ready (cold start). The caller queues the route to
 *    flush once auth is ready and, when the concrete path is one AuthGate can
 *    restore, also passes `restorePath` to the redirect-intent store so a
 *    signed-out cold start lands on the target after sign-in instead of on the
 *    default `(tabs)` screen.
 */
export function decideTapAction(data: Partial<PushData>, auth: TapAuthState): TapAction {
  const route = resolveNotificationRoute(data);
  if (!route) return { kind: 'drop' };
  if (isReadyToRoute(auth)) return { kind: 'push', route };
  const concrete = toConcretePath(route);
  return { kind: 'defer', route, restorePath: isRestorablePath(concrete) ? concrete : null };
}
