// ─────────────────────────────────────────────
// Syncs React Query onlineManager and focusManager with platform events.
// - onlineManager: wires to @react-native-community/netinfo on native if present
// - focusManager: wires to React Native AppState (active/background) on native
// ─────────────────────────────────────────────

import { AppState, type AppStateStatus, Platform } from 'react-native';
import { focusManager, onlineManager } from '@tanstack/react-query';

export type NetInfoStateLike = {
  isConnected: boolean | null;
  isInternetReachable?: boolean | null;
};

export type NetInfoLike = {
  addEventListener: (listener: (state: NetInfoStateLike) => void) => () => void;
};

export function setupFocusManager(): () => void {
  if (Platform.OS === 'web') {
    return () => {};
  }

  let unsubscribe: (() => void) | null = null;

  focusManager.setEventListener((onFocus) => {
    const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
      onFocus(status === 'active');
    });

    unsubscribe = () => {
      subscription.remove();
    };

    return () => {
      unsubscribe?.();
      unsubscribe = null;
    };
  });

  return () => {
    unsubscribe?.();
    unsubscribe = null;
  };
}

function resolveNativeNetInfo(): NetInfoLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-community/netinfo');
    return (mod?.default ?? mod) as NetInfoLike;
  } catch {
    return null;
  }
}

export function setupOnlineManager(customNetInfo?: NetInfoLike | null): () => void {
  const netInfo =
    customNetInfo !== undefined
      ? customNetInfo
      : Platform.OS !== 'web'
        ? resolveNativeNetInfo()
        : null;

  if (netInfo) {
    let unsubscribe: (() => void) | null = null;

    onlineManager.setEventListener((setOnline) => {
      unsubscribe = netInfo.addEventListener((state) => {
        const isOnline = Boolean(
          state.isConnected && (state.isInternetReachable ?? true),
        );
        setOnline(isOnline);
      });

      return () => {
        unsubscribe?.();
        unsubscribe = null;
      };
    });

    return () => {
      unsubscribe?.();
      unsubscribe = null;
    };
  }

  return () => {};
}

export function setupQueryLifecycleSync(options?: {
  netInfo?: NetInfoLike | null;
}): () => void {
  const unsubFocus = setupFocusManager();
  const unsubOnline = setupOnlineManager(options?.netInfo);

  return () => {
    unsubFocus();
    unsubOnline();
  };
}
