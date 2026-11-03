import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AppState, type AppStateStatus, Platform } from 'react-native';
import { focusManager, onlineManager } from '@tanstack/react-query';
import {
  setupOnlineManager,
  setupFocusManager,
  setupQueryLifecycleSync,
  type NetInfoLike,
  type NetInfoStateLike,
} from '../queryLifecycleSync';

describe('queryLifecycleSync', () => {
  const originalPlatform = Platform.OS;

  beforeEach(() => {
    Platform.OS = 'ios';
  });

  afterEach(() => {
    Platform.OS = originalPlatform;
    vi.restoreAllMocks();
  });

  describe('setupOnlineManager', () => {
    it('wires NetInfo events to onlineManager when NetInfo is provided', () => {
      let listener: ((state: NetInfoStateLike) => void) | null = null;
      const unsubscribeSpy = vi.fn();

      const mockNetInfo: NetInfoLike = {
        addEventListener: vi.fn().mockImplementation((cb) => {
          listener = cb;
          return unsubscribeSpy;
        }),
      };

      const cleanup = setupOnlineManager(mockNetInfo);
      expect(mockNetInfo.addEventListener).toHaveBeenCalledTimes(1);
      expect(listener).not.toBeNull();

      // Emit connected & reachable
      listener!({ isConnected: true, isInternetReachable: true });
      expect(onlineManager.isOnline()).toBe(true);

      // Emit disconnected
      listener!({ isConnected: false, isInternetReachable: false });
      expect(onlineManager.isOnline()).toBe(false);

      // Emit connected but internet unreachable
      listener!({ isConnected: true, isInternetReachable: false });
      expect(onlineManager.isOnline()).toBe(false);

      // Cleanup
      cleanup();
      expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
    });

    it('gracefully handles missing NetInfo without throwing', () => {
      expect(() => {
        const cleanup = setupOnlineManager(null);
        cleanup();
      }).not.toThrow();
    });
  });

  describe('setupFocusManager', () => {
    it('wires AppState change events to focusManager on native platforms', () => {
      Platform.OS = 'android';
      let appStateListener: ((status: AppStateStatus) => void) | null = null;
      const removeSubscriptionSpy = vi.fn();

      vi.spyOn(AppState, 'addEventListener').mockImplementation((_event, cb) => {
        appStateListener = cb;
        return { remove: removeSubscriptionSpy } as never;
      });

      const cleanup = setupFocusManager();
      expect(AppState.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
      expect(appStateListener).not.toBeNull();

      // Foregrounding
      appStateListener!('active');
      expect(focusManager.isFocused()).toBe(true);

      // Backgrounding
      appStateListener!('background');
      expect(focusManager.isFocused()).toBe(false);

      cleanup();
      expect(removeSubscriptionSpy).toHaveBeenCalledTimes(1);
    });

    it('no-ops on web where window focus is handled natively by browser', () => {
      Platform.OS = 'web';
      const spy = vi.spyOn(AppState, 'addEventListener');

      const cleanup = setupFocusManager();
      expect(spy).not.toHaveBeenCalled();

      cleanup();
    });
  });

  describe('setupQueryLifecycleSync', () => {
    it('initializes both managers and returns combined cleanup', () => {
      Platform.OS = 'ios';
      const removeAppStateSpy = vi.fn();
      vi.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: removeAppStateSpy } as never);

      const removeNetInfoSpy = vi.fn();
      const mockNetInfo: NetInfoLike = {
        addEventListener: vi.fn().mockReturnValue(removeNetInfoSpy),
      };

      const cleanup = setupQueryLifecycleSync({ netInfo: mockNetInfo });

      cleanup();
      expect(removeAppStateSpy).toHaveBeenCalledTimes(1);
      expect(removeNetInfoSpy).toHaveBeenCalledTimes(1);
    });
  });
});
