import { create } from 'zustand';
import { onlineManager } from '@tanstack/react-query';

export interface NetworkStatusState {
  isOnline: boolean;
  isInternetReachable: boolean | null;
  setOnline: (isOnline: boolean, isInternetReachable?: boolean | null) => void;
}

export const useNetworkStatusStore = create<NetworkStatusState>((set) => ({
  isOnline: onlineManager.isOnline(),
  isInternetReachable: null,
  setOnline: (isOnline: boolean, isInternetReachable: boolean | null = null) =>
    set({ isOnline, isInternetReachable }),
}));

// Sync with react-query's onlineManager events
onlineManager.subscribe((isOnline) => {
  useNetworkStatusStore.getState().setOnline(isOnline);
});

export function useNetworkStatus(): {
  isOnline: boolean;
  isInternetReachable: boolean | null;
} {
  const isOnline = useNetworkStatusStore((s) => s.isOnline);
  const isInternetReachable = useNetworkStatusStore((s) => s.isInternetReachable);
  return { isOnline, isInternetReachable };
}
