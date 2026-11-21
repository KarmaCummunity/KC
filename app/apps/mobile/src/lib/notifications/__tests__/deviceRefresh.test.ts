import { describe, it, expect, vi, beforeEach } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */

// vi.mock factories are hoisted above the imports, so the state they share is hoisted too:
// the AppState listener the module installs, how many times it was removed, and the
// registration spy.
const { appState, register } = vi.hoisted(() => ({
  appState: { listener: null as ((state: string) => void) | null, removed: 0 },
  register: vi.fn(() => Promise.resolve()),
}));

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (_event: string, cb: (state: string) => void) => {
      appState.listener = cb;
      return { remove: () => { appState.removed += 1; } };
    },
  },
}));

vi.mock('../register', () => ({ registerCurrentDeviceIfPermitted: register }));

import { DEVICE_REFRESH_INTERVAL_MS, isDeviceRefreshDue, watchDailyDeviceRefresh } from '../deviceRefresh';

const deps = { deviceRepo: {} as any };
const DAY = DEVICE_REFRESH_INTERVAL_MS;

describe('isDeviceRefreshDue', () => {
  it('is due once a full day passed since the last registration', () => {
    expect(isDeviceRefreshDue(0, DAY)).toBe(true);
    expect(isDeviceRefreshDue(0, DAY + 1)).toBe(true);
  });

  it('is not due within the day, nor when the clock moved backwards', () => {
    expect(isDeviceRefreshDue(0, DAY - 1)).toBe(false);
    expect(isDeviceRefreshDue(DAY, 0)).toBe(false);
  });
});

describe('watchDailyDeviceRefresh', () => {
  beforeEach(() => {
    appState.listener = null;
    appState.removed = 0;
    register.mockClear();
  });

  it('re-registers when the app returns to the foreground a day after the last registration', () => {
    let now = 1_000;
    watchDailyDeviceRefresh('u_1', deps, () => now);

    now += DAY - 1;
    appState.listener!('active');
    expect(register).not.toHaveBeenCalled();

    now += 1;
    appState.listener!('active');
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith('u_1', deps);
  });

  it('refreshes at most once a day, however often the app is foregrounded', () => {
    let now = 0;
    watchDailyDeviceRefresh('u_1', deps, () => now);
    now = DAY;
    appState.listener!('active');
    appState.listener!('active');
    now = DAY + DAY / 2;
    appState.listener!('active');
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('ignores the background and inactive states', () => {
    let now = 0;
    watchDailyDeviceRefresh('u_1', deps, () => now);
    now = 2 * DAY;
    appState.listener!('background');
    appState.listener!('inactive');
    expect(register).not.toHaveBeenCalled();
  });

  it('keeps watching after a failed registration', async () => {
    let now = 0;
    register.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    watchDailyDeviceRefresh('u_1', deps, () => now);
    now = DAY;
    appState.listener!('active');
    await Promise.resolve();
    now = 2 * DAY;
    appState.listener!('active');
    expect(register).toHaveBeenCalledTimes(2);
  });

  it('stops listening when unsubscribed', () => {
    const stop = watchDailyDeviceRefresh('u_1', deps, () => 0);
    stop();
    expect(appState.removed).toBe(1);
  });
});
