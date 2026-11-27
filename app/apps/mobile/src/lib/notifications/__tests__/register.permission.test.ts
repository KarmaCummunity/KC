import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DeviceRegistration } from '@kc/domain';

/* eslint-disable @typescript-eslint/no-explicit-any */

const deviceIsDevice = { current: true };
const permStatus = { current: 'granted' as 'granted' | 'denied' };
const expoProjectId = { current: 'project-123' as string | null };
const pushToken = { current: 'ExponentPushToken[xyz]' };

vi.mock('expo-device', () => ({
  get isDevice() { return deviceIsDevice.current; },
}));
vi.mock('../channels', () => ({ ensureNotificationChannels: () => Promise.resolve() }));
vi.mock('expo-notifications', () => ({
  addPushTokenListener: () => ({ remove: () => undefined }),
  getPermissionsAsync: () => Promise.resolve({ status: permStatus.current }),
  getExpoPushTokenAsync: () => Promise.resolve({ data: pushToken.current }),
}));
vi.mock('expo-constants', () => ({
  default: {
    get expoConfig() { return { extra: { eas: { projectId: expoProjectId.current } } }; },
  },
}));

import { registerCurrentDeviceIfPermitted, deactivateCurrentDevice } from '../register';

function makeDeviceRepo(): { registered: DeviceRegistration[]; deactivated: string[]; repo: any } {
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

describe('registerCurrentDeviceIfPermitted — permission (guideline 4.5.4)', () => {
  it('does not register a token when notification permission is not granted', async () => {
    permStatus.current = 'denied';
    const { repo, registered } = makeDeviceRepo();
    await registerCurrentDeviceIfPermitted('u_me', { deviceRepo: repo });
    expect(registered).toEqual([]);
  });

  it('deactivates a previously saved token when permission is later withdrawn', async () => {
    const { repo, registered, deactivated } = makeDeviceRepo();
    await registerCurrentDeviceIfPermitted('u_me', { deviceRepo: repo });
    expect(registered).toHaveLength(1);
    permStatus.current = 'denied';
    await registerCurrentDeviceIfPermitted('u_me', { deviceRepo: repo });
    expect(deactivated).toEqual(['ExponentPushToken[xyz]']);
  });
});

describe('deactivateCurrentDevice — permission (guideline 4.5.4)', () => {
  it('does not fetch a push token on logout when permission is not granted and none is cached', async () => {
    permStatus.current = 'denied';
    const { repo, deactivated } = makeDeviceRepo();
    const mod = await import('expo-notifications');
    const getter = vi.spyOn(mod, 'getExpoPushTokenAsync');
    await deactivateCurrentDevice({ deviceRepo: repo });
    expect(getter).not.toHaveBeenCalled();
    expect(deactivated).toEqual([]);
    getter.mockRestore();
  });
});
