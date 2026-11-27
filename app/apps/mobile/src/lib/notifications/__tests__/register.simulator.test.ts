// The DEV simulator opt-in of device push (`extra.pushSimulatorEnabled`): a dedicated DEV test
// binary may register, refresh and deactivate a push token on a simulator, while an ordinary
// build never does. Kept apart from register.test.ts, which covers the real-device behaviour.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DeviceRegistration } from '@kc/domain';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Not a physical device in every case here: the simulator is the subject.
const simulatorEnabled = { current: false };
const tokenListeners: (() => void)[] = [];

vi.mock('expo-device', () => ({ isDevice: false }));
vi.mock('../channels', () => ({ ensureNotificationChannels: () => Promise.resolve() }));
vi.mock('expo-notifications', () => ({
  addPushTokenListener: (cb: () => void) => {
    tokenListeners.push(cb);
    return { remove: () => undefined };
  },
  getPermissionsAsync: () => Promise.resolve({ status: 'granted' }),
  getExpoPushTokenAsync: () => Promise.resolve({ data: 'ExponentPushToken[sim]' }),
}));
vi.mock('expo-constants', () => ({
  default: {
    get expoConfig() {
      return { extra: { pushSimulatorEnabled: simulatorEnabled.current, eas: { projectId: 'project-123' } } };
    },
  },
}));

import { registerCurrentDeviceIfPermitted, deactivateCurrentDevice, watchPushTokenRefresh } from '../register';

function makeDeviceRepo() {
  const registered: DeviceRegistration[] = [];
  const deactivated: string[] = [];
  const repo: any = {
    upsert: vi.fn((reg: DeviceRegistration) => {
      registered.push(reg);
      return Promise.resolve({ deviceId: 'd_1', ...reg });
    }),
    deactivate: vi.fn((token: string) => {
      deactivated.push(token);
      return Promise.resolve();
    }),
  };
  return { repo, registered, deactivated };
}

beforeEach(() => {
  simulatorEnabled.current = false;
  tokenListeners.length = 0;
});

describe('simulator opt-in of device push', () => {
  it('does not register a simulator unless the DEV binary enables it', async () => {
    const { repo, registered } = makeDeviceRepo();
    await registerCurrentDeviceIfPermitted('u_dev_test', { deviceRepo: repo });
    expect(registered).toEqual([]);
  });

  it('registers an explicitly enabled DEV simulator diagnostic binary', async () => {
    simulatorEnabled.current = true;
    const { repo, registered } = makeDeviceRepo();
    await registerCurrentDeviceIfPermitted('u_dev_test', { deviceRepo: repo });
    expect(registered).toHaveLength(1);
  });

  it('deactivates an explicitly enabled DEV simulator on logout, and only then', async () => {
    const off = makeDeviceRepo();
    await deactivateCurrentDevice({ deviceRepo: off.repo });
    expect(off.deactivated).toEqual([]);

    simulatorEnabled.current = true;
    const on = makeDeviceRepo();
    await deactivateCurrentDevice({ deviceRepo: on.repo });
    expect(on.deactivated).toEqual(['ExponentPushToken[sim]']);
  });

  it('watches token rotation on an enabled DEV simulator, and not otherwise', () => {
    watchPushTokenRefresh('u_dev_test', { deviceRepo: makeDeviceRepo().repo });
    expect(tokenListeners).toHaveLength(0);

    simulatorEnabled.current = true;
    watchPushTokenRefresh('u_dev_test', { deviceRepo: makeDeviceRepo().repo });
    expect(tokenListeners).toHaveLength(1);
  });
});
