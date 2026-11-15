import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DeviceRegistration } from '@kc/domain';

/* eslint-disable @typescript-eslint/no-explicit-any */

const deviceIsDevice = { current: true };
const permStatus = { current: 'granted' as 'granted' | 'denied' };
const expoProjectId = { current: 'project-123' as string | null };
const pushToken = { current: 'ExponentPushToken[xyz]' };

vi.mock('expo-device', () => ({
  // The module reads .isDevice at call time, so getter routing keeps it dynamic.
  get isDevice() { return deviceIsDevice.current; },
}));

const tokenListener = { current: null as (() => void) | null, removed: 0 };
vi.mock('../channels', () => ({ ensureNotificationChannels: () => Promise.resolve() }));

vi.mock('expo-notifications', () => ({
  addPushTokenListener: (cb: () => void) => {
    tokenListener.current = cb;
    return { remove: () => { tokenListener.removed += 1; } };
  },
  getPermissionsAsync: () => Promise.resolve({ status: permStatus.current }),
  getExpoPushTokenAsync: () => Promise.resolve({ data: pushToken.current }),
}));

vi.mock('expo-constants', () => ({
  default: {
    get expoConfig() { return { extra: { eas: { projectId: expoProjectId.current } } }; },
  },
}));

// react-native is already aliased to react-native-web in mobile vitest config.

import { registerCurrentDeviceIfPermitted, deactivateCurrentDevice, watchPushTokenRefresh } from '../register';

function makeDeviceRepo(): {
  registered: DeviceRegistration[];
  deactivated: string[];
  repo: any;
} {
  const registered: DeviceRegistration[] = [];
  const deactivated: string[] = [];
  return {
    registered,
    deactivated,
    repo: {
      upsert: vi.fn((reg: DeviceRegistration) => {
        registered.push(reg);
        return Promise.resolve({ deviceId: 'd_1', ...reg } as any);
      }),
      deactivate: vi.fn((token: string) => {
        deactivated.push(token);
        return Promise.resolve();
      }),
    },
  };
}

beforeEach(() => {
  deviceIsDevice.current = true;
  permStatus.current = 'granted';
  expoProjectId.current = 'project-123';
  pushToken.current = 'ExponentPushToken[xyz]';
});

describe('registerCurrentDeviceIfPermitted', () => {
  it('happy path: registers the device with the Expo push token + detected platform', async () => {
    const { repo, registered } = makeDeviceRepo();
    await registerCurrentDeviceIfPermitted('u_me', { deviceRepo: repo });
    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatchObject({
      userId: 'u_me',
      pushToken: 'ExponentPushToken[xyz]',
    });
    // Platform in vitest (jsdom-via-react-native-web) is 'web'.
    expect(['ios', 'android', 'web']).toContain(registered[0]!.platform);
  });

  it('is a no-op on a simulator/emulator (Device.isDevice === false)', async () => {
    deviceIsDevice.current = false;
    const { repo, registered } = makeDeviceRepo();
    await registerCurrentDeviceIfPermitted('u_me', { deviceRepo: repo });
    expect(registered).toEqual([]);
  });

  it('is a no-op when notification permission is not granted', async () => {
    permStatus.current = 'denied';
    const { repo, registered } = makeDeviceRepo();
    await registerCurrentDeviceIfPermitted('u_me', { deviceRepo: repo });
    expect(registered).toEqual([]);
  });

  it('logs a warning and is a no-op when EAS projectId is missing (build misconfig)', async () => {
    expoProjectId.current = null;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { repo, registered } = makeDeviceRepo();
    await registerCurrentDeviceIfPermitted('u_me', { deviceRepo: repo });
    expect(registered).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/EAS projectId/));
    warn.mockRestore();
  });
});

describe('deactivateCurrentDevice', () => {
  it('happy path: looks up the current Expo push token and deactivates it', async () => {
    const { repo, deactivated } = makeDeviceRepo();
    await deactivateCurrentDevice({ deviceRepo: repo });
    expect(deactivated).toEqual(['ExponentPushToken[xyz]']);
  });

  it('is a no-op on a simulator (Device.isDevice === false)', async () => {
    deviceIsDevice.current = false;
    const { repo, deactivated } = makeDeviceRepo();
    await deactivateCurrentDevice({ deviceRepo: repo });
    expect(deactivated).toEqual([]);
  });

  it('is a no-op when EAS projectId is missing', async () => {
    expoProjectId.current = null;
    const { repo, deactivated } = makeDeviceRepo();
    await deactivateCurrentDevice({ deviceRepo: repo });
    expect(deactivated).toEqual([]);
  });

  it('swallows getExpoPushTokenAsync errors silently (token unavailable → nothing to deactivate)', async () => {
    const { repo, deactivated } = makeDeviceRepo();
    const mod = await import('expo-notifications');
    vi.spyOn(mod, 'getExpoPushTokenAsync').mockRejectedValueOnce(new Error('no token'));
    await expect(deactivateCurrentDevice({ deviceRepo: repo })).resolves.toBeUndefined();
    expect(deactivated).toEqual([]);
  });
});

describe('watchPushTokenRefresh', () => {
  beforeEach(() => {
    deviceIsDevice.current = true;
    permStatus.current = 'granted';
    expoProjectId.current = 'project-123';
  });

  it('registers the device again when the platform rotates the token, until unsubscribed', async () => {
    const { repo, registered } = makeDeviceRepo();
    const stop = watchPushTokenRefresh('u_1', { deviceRepo: repo });
    pushToken.current = 'ExponentPushToken[rotated]';
    tokenListener.current?.();
    await vi.waitFor(() => expect(registered).toHaveLength(1));
    expect(registered[0]).toEqual({ userId: 'u_1', pushToken: 'ExponentPushToken[rotated]', platform: expect.any(String) });
    const before = tokenListener.removed;
    stop();
    expect(tokenListener.removed).toBe(before + 1);
  });

  it('does not listen on a simulator', () => {
    deviceIsDevice.current = false;
    tokenListener.current = null;
    const { repo } = makeDeviceRepo();
    watchPushTokenRefresh('u_1', { deviceRepo: repo })();
    expect(tokenListener.current).toBeNull();
  });
});
