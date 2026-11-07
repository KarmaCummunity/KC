// FR-POST-001 AC6 — the remembered create choice is per user and best-effort: storage errors
// never reach the form.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn() }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }));

import { loadCreatePreferences, saveCreatePreferences } from '../createPreferencesStorage';

beforeEach(() => {
  storage.getItem.mockReset();
  storage.setItem.mockReset();
});

describe('create preferences storage', () => {
  it('reads and writes one key per user', async () => {
    storage.getItem.mockResolvedValue('{"categoryId":"time","directions":{"time":"request"}}');
    await expect(loadCreatePreferences('u1')).resolves.toEqual({
      categoryId: 'time',
      directions: { time: 'request' },
      usageCounts: {},
    });
    expect(storage.getItem).toHaveBeenCalledWith('kc-create-preferences-u1');

    await saveCreatePreferences('u1', { categoryId: 'food', directions: { food: 'give' }, usageCounts: {} });
    expect(storage.setItem).toHaveBeenCalledWith(
      'kc-create-preferences-u1',
      '{"categoryId":"food","directions":{"food":"give"},"usageCounts":{}}',
    );
  });

  it('guests share one device-level slot', async () => {
    storage.getItem.mockResolvedValue(null);
    await loadCreatePreferences(null);
    expect(storage.getItem).toHaveBeenCalledWith('kc-create-preferences-guest');
  });

  it('a failing read returns the defaults and a failing write is swallowed', async () => {
    storage.getItem.mockRejectedValue(new Error('quota'));
    storage.setItem.mockRejectedValue(new Error('quota'));
    await expect(loadCreatePreferences('u1')).resolves.toEqual({ categoryId: 'items', directions: {}, usageCounts: {} });
    await expect(
      saveCreatePreferences('u1', { categoryId: 'rides', directions: {}, usageCounts: {} }),
    ).resolves.toBeUndefined();
  });
});
