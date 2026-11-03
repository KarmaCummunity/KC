import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory AsyncStorage so the per-day dedupe key round-trips.
const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  },
}));

import { localDayKey, recordActiveDayOncePerDay } from '../activeDay';

const DAY_1 = new Date(2026, 9, 30, 9, 0);
const DAY_1_EVENING = new Date(2026, 9, 30, 23, 30);
const DAY_2 = new Date(2026, 9, 31, 0, 5);

describe('recordActiveDayOncePerDay', () => {
  beforeEach(() => store.clear());

  it('records once per user per local day', async () => {
    const record = vi.fn(async () => undefined);
    await recordActiveDayOncePerDay('u1', record, DAY_1);
    await recordActiveDayOncePerDay('u1', record, DAY_1_EVENING);
    expect(record).toHaveBeenCalledTimes(1);

    await recordActiveDayOncePerDay('u1', record, DAY_2);
    expect(record).toHaveBeenCalledTimes(2);
  });

  it('records each user separately on a shared device', async () => {
    const record = vi.fn(async () => undefined);
    await recordActiveDayOncePerDay('u1', record, DAY_1);
    await recordActiveDayOncePerDay('u2', record, DAY_1);
    expect(record).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight call between concurrent callers', async () => {
    let release: () => void = () => undefined;
    const record = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const first = recordActiveDayOncePerDay('u1', record, DAY_1);
    const second = recordActiveDayOncePerDay('u1', record, DAY_1);
    expect(second).toBe(first);
    // The record call starts after the storage read resolves.
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    release();
    await Promise.all([first, second]);
  });

  it('swallows a failure and retries on the next call', async () => {
    const record = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
    await expect(recordActiveDayOncePerDay('u1', record, DAY_1)).resolves.toBeUndefined();
    await recordActiveDayOncePerDay('u1', record, DAY_1);
    expect(record).toHaveBeenCalledTimes(2);
  });
});

describe('localDayKey', () => {
  it('formats the local calendar day with zero padding', () => {
    expect(localDayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});
