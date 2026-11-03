// FR-SETTINGS-018 / TD-178 — after a language switch flips the reading
// direction, a production native build must really reload. DevSettings.reload
// only exists in dev builds, so production reloads through expo-updates.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const updates = vi.hoisted(() => ({ isEnabled: true, reloadAsync: vi.fn() }));
const devReload = vi.hoisted(() => vi.fn());

vi.mock('expo-updates', () => updates);
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  DevSettings: { reload: devReload },
  I18nManager: { allowRTL: vi.fn(), forceRTL: vi.fn(), isRTL: true },
}));

import { reloadApp } from '../language';

describe('reloadApp on native (TD-178)', () => {
  beforeEach(() => {
    updates.reloadAsync.mockReset().mockResolvedValue(undefined);
    devReload.mockReset();
  });

  it('reloads through expo-updates in a release build', async () => {
    updates.isEnabled = true;
    reloadApp();
    await vi.waitFor(() => expect(updates.reloadAsync).toHaveBeenCalledTimes(1));
    expect(devReload).not.toHaveBeenCalled();
  });

  it('falls back to DevSettings when updates are disabled (dev client / Expo Go)', async () => {
    updates.isEnabled = false;
    reloadApp();
    await vi.waitFor(() => expect(devReload).toHaveBeenCalledTimes(1));
    expect(updates.reloadAsync).not.toHaveBeenCalled();
  });

  it('falls back to DevSettings when the expo-updates reload rejects', async () => {
    updates.isEnabled = true;
    updates.reloadAsync.mockRejectedValue(new Error('reload failed'));
    reloadApp();
    await vi.waitFor(() => expect(devReload).toHaveBeenCalledTimes(1));
  });
});
