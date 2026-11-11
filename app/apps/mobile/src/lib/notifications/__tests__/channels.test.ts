import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTIFICATION_CATEGORIES } from '@kc/domain';

const { platform, setChannel, deleteChannel, setCategory } = vi.hoisted(() => ({
  platform: { OS: 'android' },
  setChannel: vi.fn((_id: string, _channel: Record<string, unknown>) => Promise.resolve()),
  deleteChannel: vi.fn((_id: string) => Promise.resolve()),
  setCategory: vi.fn((_id: string, _actions: unknown[]) => Promise.resolve()),
}));

vi.mock('react-native', () => ({ Platform: platform }));
vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 6, DEFAULT: 5 },
  setNotificationChannelAsync: setChannel,
  deleteNotificationChannelAsync: deleteChannel,
  setNotificationCategoryAsync: setCategory,
}));
vi.mock('@kc/ui', () => ({ lightColors: { primaryVivid: '#F97316' } }));
vi.mock('../../../i18n', () => ({ default: { t: (key: string) => `t:${key}` } }));

import { ensureNotificationChannels } from '../channels';

beforeEach(() => vi.clearAllMocks());

describe('ensureNotificationChannels', () => {
  it('creates one Android channel per category, with the id the push worker sends', async () => {
    platform.OS = 'android';
    await ensureNotificationChannels();
    expect(setChannel.mock.calls.map(([id]) => id)).toEqual([...NOTIFICATION_CATEGORIES]);
    expect(setChannel).toHaveBeenCalledWith('critical', expect.objectContaining({
      name: 't:notifications.criticalLabel', importance: 6, sound: 'default', enableVibrate: true,
    }));
    expect(setChannel).toHaveBeenCalledWith('social', expect.objectContaining({
      name: 't:notifications.socialLabel', importance: 5, sound: null, enableVibrate: false,
    }));
    expect(deleteChannel).toHaveBeenCalledWith('kc-default');
    expect(setCategory).not.toHaveBeenCalled();
  });

  it('registers one iOS category per category', async () => {
    platform.OS = 'ios';
    await ensureNotificationChannels();
    expect(setCategory.mock.calls).toEqual(NOTIFICATION_CATEGORIES.map((category) => [category, []]));
    expect(setChannel).not.toHaveBeenCalled();
  });

  it('does nothing on web', async () => {
    platform.OS = 'web';
    await ensureNotificationChannels();
    expect(setChannel).not.toHaveBeenCalled();
    expect(setCategory).not.toHaveBeenCalled();
  });
});
