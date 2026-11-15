import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import type { PushData } from '@kc/domain';
import { useAuthStore } from '../../store/authStore';
import { useRedirectIntentStore } from '../../store/redirectIntentStore';
import { decideTapAction, isReadyToRoute, type ResolvedRoute } from './tapRouting';

// Routes are derived from the typed notification `kind` against a closed map
// (notificationRoutes / TD-102), never from a path carried in the payload.
// tapRouting.ts owns that resolution plus the cold-start gating.

function pushRoute(route: ResolvedRoute): void {
  router.push({ pathname: route.pathname as never, params: route.params });
}

// A single queued cold-start tap, flushed once auth becomes ready. Module-level
// so the foreground listener and the cold-start read share one slot — the last
// tap wins, which matches intent (the user opened the most recent notification).
let pendingTapRoute: ResolvedRoute | null = null;

function handleNotificationTap(data: Partial<PushData> | null | undefined): void {
  if (!data || typeof data !== 'object') return;
  const action = decideTapAction(data, useAuthStore.getState());
  if (action.kind === 'push') {
    pushRoute(action.route);
  } else if (action.kind === 'defer') {
    // Cold start: queue for the post-auth flush below, and — for a restorable
    // target — hand the path to the redirect-intent store so AuthGate restores
    // it after a signed-out sign-in instead of clobbering it with (tabs).
    pendingTapRoute = action.route;
    if (action.restorePath) {
      useRedirectIntentStore.getState().capturePath(action.restorePath);
    }
  }
}

export function useNotificationTapRouting(): void {
  useEffect(() => {
    if (Platform.OS === 'web') {
      return undefined;
    }
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      handleNotificationTap(response.notification.request.content.data as Partial<PushData> | null);
    });
    // Cold-start: a tap may have launched the app (native only).
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        handleNotificationTap(response.notification.request.content.data as Partial<PushData> | null);
      }
    });
    // Flush a queued cold-start tap once the session has restored and onboarding
    // is complete, so AuthGate's redirect no longer clobbers it (TD-119 / TD-3).
    const unsubscribeAuth = useAuthStore.subscribe((state) => {
      if (pendingTapRoute && isReadyToRoute(state)) {
        const route = pendingTapRoute;
        pendingTapRoute = null;
        pushRoute(route);
      }
    });
    return () => {
      sub.remove();
      unsubscribeAuth();
    };
  }, []);
}
