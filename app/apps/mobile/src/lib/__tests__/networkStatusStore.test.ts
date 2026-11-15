import { describe, it, expect, beforeEach } from 'vitest';
import { useNetworkStatusStore } from '../networkStatusStore';

describe('networkStatusStore', () => {
  beforeEach(() => {
    useNetworkStatusStore.setState({ isOnline: true, isInternetReachable: true });
  });

  it('updates online status correctly', () => {
    expect(useNetworkStatusStore.getState().isOnline).toBe(true);

    useNetworkStatusStore.getState().setOnline(false, false);
    expect(useNetworkStatusStore.getState().isOnline).toBe(false);
    expect(useNetworkStatusStore.getState().isInternetReachable).toBe(false);

    useNetworkStatusStore.getState().setOnline(true, true);
    expect(useNetworkStatusStore.getState().isOnline).toBe(true);
    expect(useNetworkStatusStore.getState().isInternetReachable).toBe(true);
  });
});
