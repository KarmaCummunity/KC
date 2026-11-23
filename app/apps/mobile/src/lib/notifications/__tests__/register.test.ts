import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DeviceRegistration } from '@kc/domain';
import type { DevicePushToken } from 'expo-notifications';

/* eslint-disable @typescript-eslint/no-explicit-any */

const deviceIsDevice = { current: true };
const permStatus = { current: 'granted' as 'granted' | 'denied' };
const simulatorEnabled = { current: false };
const expoProjectId = { current: 'project-123' as string | null };
const pushToken = { current: 'ExponentPushToken[xyz]' };

vi.mock('expo-device', () => ({
  // The module reads .isDevice at call time, so getter routing keeps it dynamic.
  get isDevice() { return deviceIsDevice.current; },
}));

const nativeToken: DevicePushToken = { type: 'ios', data: 'synthetic-native-token' };
const tokenListener = { current: null as ((token: DevicePushToken) => void) | null, removed: 0 };
const feedback = { enabled: false, acquisitions: 0, calls: [] as { devicePushToken?: DevicePushToken }[] };
vi.mock('../channels', () => ({ ensureNotificationChannels: () => Promise.resolve() }));

vi.mock('expo-notifications', () => ({
  addPushTokenListener: (cb: (token: DevicePushToken) => void) => {
    tokenListener.current = cb;
    return { remove: () => { tokenListener.removed += 1; } };
  },
  getPermissionsAsync: () => Promise.resolve({ status: permStatus.current }),
  getExpoPushTokenAsync: (options: { devicePushToken?: DevicePushToken }) => {
    feedback.calls.push(options);
    if (feedback.enabled && !options.devicePushToken) {
      feedback.acquisitions += 1;
      // Model the actual iOS SDK: every native acquisition emits the listener. Bound
      // the unpatched loop so the regression fails cleanly instead of hanging the test.
      if (feedback.acquisitions < 6) tokenListener.current?.(nativeToken);
    }
    return Promise.resolve({ data: pushToken.current });
  },
}));

vi.mock('expo-constants', () => ({
  default: {
    get expoConfig() { return { extra: { pushSimulatorEnabled: simulatorEnabled.current, eas: { projectId: expoProjectId.current } } }; },
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
  simulatorEnabled.current = false;
  permStatus.current = 'granted';
  expoProjectId.current = 'project-123';
  pushToken.current = 'ExponentPushToken[xyz]';
  feedback.enabled = false; feedback.acquisitions = 0; feedback.calls = [];
  tokenListener.current = null;
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

  it('registers only an explicitly enabled DEV simulator diagnostic binary', async () => {
    deviceIsDevice.current = false; simulatorEnabled.current = true;
    const { repo, registered } = makeDeviceRepo();
    await registerCurrentDeviceIfPermitted('u_dev_test', { deviceRepo: repo });
    expect(registered).toHaveLength(1);
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

  it('deactivates an explicitly enabled DEV simulator on logout', async () => {
    deviceIsDevice.current = false; simulatorEnabled.current = true;
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
  simulatorEnabled.current = false;
    permStatus.current = 'granted';
    expoProjectId.current = 'project-123';
  });

  it('registers the device again when the platform rotates the token, until unsubscribed', async () => {
    const { repo, registered } = makeDeviceRepo();
    const stop = watchPushTokenRefresh('u_1', { deviceRepo: repo });
    pushToken.current = 'ExponentPushToken[rotated]';
    tokenListener.current?.(nativeToken);
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


describe('native token feedback regression', () => {
  it('does not reacquire the native token from its own refresh callback or flood backend upserts', async () => {
    const { repo, registered } = makeDeviceRepo();
    feedback.enabled = true;
    const stop = watchPushTokenRefresh('u_loop', { deviceRepo: repo });
    await registerCurrentDeviceIfPermitted('u_loop', { deviceRepo: repo });
    await vi.waitFor(() => expect(registered).toHaveLength(1));
    expect(feedback.acquisitions).toBe(1);
    expect(feedback.calls.some(call => call.devicePushToken === nativeToken)).toBe(true);
    stop();
  });
  it('coalesces repeated same-token events, but persists a real rotated Expo token', async () => {
    const { repo, registered } = makeDeviceRepo();
    const stop = watchPushTokenRefresh('u_loop', { deviceRepo: repo });
    for (let i = 0; i < 100; i++) tokenListener.current?.(nativeToken);
    await vi.waitFor(() => expect(registered).toHaveLength(1));
    expect(feedback.calls).toHaveLength(1);
    tokenListener.current?.(nativeToken);
    await Promise.resolve();
    expect(feedback.calls).toHaveLength(1);
    pushToken.current = 'ExponentPushToken[rotated]';
    tokenListener.current?.({ type: 'ios', data: 'rotated-native-token' });
    await vi.waitFor(() => expect(registered).toHaveLength(2));
    stop();
  });
  it('does not cache a failed backend registration and isolates different users', async () => {
    const { repo, registered } = makeDeviceRepo();
    repo.upsert.mockRejectedValueOnce(new Error('temporary backend failure'));
    await expect(registerCurrentDeviceIfPermitted('u_a', { deviceRepo: repo }, nativeToken)).rejects.toThrow();
    await registerCurrentDeviceIfPermitted('u_a', { deviceRepo: repo }, nativeToken);
    await registerCurrentDeviceIfPermitted('u_b', { deviceRepo: repo }, nativeToken);
    expect(registered.map(r => r.userId)).toEqual(['u_a', 'u_b']);
  });
});

describe('registration lifecycle cancellation', () => {
  it('does not persist a refresh conversion after unsubscribe', async () => {
    const { repo, registered } = makeDeviceRepo();
    const mod = await import('expo-notifications');
    let release!: (value: { data: string }) => void;
    const waiting = new Promise<{ data: string }>(resolve => { release = resolve; });
    const getter = vi.spyOn(mod, 'getExpoPushTokenAsync').mockReturnValueOnce(waiting as any);
    const stop = watchPushTokenRefresh('old', { deviceRepo: repo });
    tokenListener.current?.(nativeToken);
    await vi.waitFor(() => expect(getter).toHaveBeenCalled());
    stop();
    release({ data: pushToken.current });
    await Promise.resolve(); await Promise.resolve();
    expect(registered).toHaveLength(0);
    getter.mockRestore();
  });
  it('a changed-user initial conversion cannot register the previous owner', async () => {
    const { repo, registered } = makeDeviceRepo();
    const mod = await import('expo-notifications');
    let release!: (value: { data: string }) => void;
    const waiting = new Promise<{ data: string }>(resolve => { release = resolve; });
    const getter = vi.spyOn(mod, 'getExpoPushTokenAsync').mockReturnValueOnce(waiting as any);
    let active = true;
    const old = registerCurrentDeviceIfPermitted('old', { deviceRepo: repo, isCurrent: () => active });
    await vi.waitFor(() => expect(getter).toHaveBeenCalled());
    active = false;
    await registerCurrentDeviceIfPermitted('new', { deviceRepo: repo });
    release({ data: pushToken.current });
    await old;
    expect(registered.map(r => r.userId)).toEqual(['new']);
    getter.mockRestore();
  });
  it('a replacement same-user effect retries a conversion cancelled by its old owner', async () => {
    const { repo, registered } = makeDeviceRepo();
    const mod = await import('expo-notifications');
    let release!: (value: { data: string }) => void;
    const waiting = new Promise<{ data: string }>(resolve => { release = resolve; });
    const getter = vi.spyOn(mod, 'getExpoPushTokenAsync').mockReturnValueOnce(waiting as any);
    let active = true;
    const old = registerCurrentDeviceIfPermitted('same', { deviceRepo: repo, isCurrent: () => active });
    await vi.waitFor(() => expect(getter).toHaveBeenCalled());
    active = false;
    const replacement = registerCurrentDeviceIfPermitted('same', { deviceRepo: repo });
    release({ data: pushToken.current });
    await Promise.all([old, replacement]);
    expect(registered.map(r => r.userId)).toEqual(['same']);
    getter.mockRestore();
  });
  it('logout token lookup cannot trigger re-registration while old watcher is mounted', async () => {
    const { repo, registered, deactivated } = makeDeviceRepo();
    feedback.enabled = true;
    const stop = watchPushTokenRefresh('old', { deviceRepo: repo });
    await deactivateCurrentDevice({ deviceRepo: repo });
    await Promise.resolve();
    expect(registered).toHaveLength(0);
    expect(deactivated).toHaveLength(1);
    expect(feedback.acquisitions).toBe(1);
    stop();
  });
  it('logout waits for an already-issued write before deleting its token', async () => {
    const { repo, deactivated } = makeDeviceRepo();
    let release!: () => void;
    repo.upsert.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const registering = registerCurrentDeviceIfPermitted('old', { deviceRepo: repo }, nativeToken);
    await vi.waitFor(() => expect(repo.upsert).toHaveBeenCalled());
    const logout = deactivateCurrentDevice({ deviceRepo: repo });
    await Promise.resolve();
    expect(deactivated).toHaveLength(0);
    release();
    await Promise.all([registering, logout]);
    expect(deactivated).toHaveLength(1);
  });
  it('late logout cleanup cannot delete a new user registration', async () => {
    const { repo, registered, deactivated } = makeDeviceRepo();
    let release!: () => void;
    repo.upsert.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const old = registerCurrentDeviceIfPermitted('old', { deviceRepo: repo }, nativeToken);
    await vi.waitFor(() => expect(repo.upsert).toHaveBeenCalled());
    const logout = deactivateCurrentDevice({ deviceRepo: repo });
    await registerCurrentDeviceIfPermitted('new', { deviceRepo: repo }, nativeToken);
    release();
    await Promise.all([old, logout]);
    expect(registered.map(r => r.userId)).toEqual(['new']);
    expect(deactivated).toHaveLength(0);
  });
});
