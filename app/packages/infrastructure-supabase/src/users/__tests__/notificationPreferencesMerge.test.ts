import { describe, it, expect } from 'vitest';
import { mergeNotificationPreferences } from '../notificationPreferencesMerge';

describe('mergeNotificationPreferences', () => {
  it('replaces the top-level keys the patch names and keeps the rest', () => {
    const merged = mergeNotificationPreferences({ critical: true, social: true }, { social: false });

    expect(merged).toEqual({ critical: true, social: false });
  });

  it('merges `kinds` per key so toggling one kind keeps the others', () => {
    const merged = mergeNotificationPreferences(
      { critical: true, kinds: { chat_message: false, follow_request: true } },
      { kinds: { follow_request: false } },
    );

    expect(merged).toEqual({ critical: true, kinds: { chat_message: false, follow_request: false } });
  });

  it('starts `kinds` from the patch when none is stored', () => {
    expect(mergeNotificationPreferences({}, { kinds: { chat_message: false } })).toEqual({
      kinds: { chat_message: false },
    });
  });

  it('replaces quiet hours as a whole', () => {
    const quietHours = { enabled: true, start: '22:00', end: '07:00', timezone: 'Asia/Jerusalem' };

    expect(
      mergeNotificationPreferences({ quietHours: { enabled: false, start: '00:00', end: '00:00', timezone: 'UTC' } }, { quietHours }),
    ).toEqual({ quietHours });
  });

  it('returns an unchanged copy for an empty patch and never mutates the stored document', () => {
    const stored = { critical: false, kinds: { chat_message: false } };

    const merged = mergeNotificationPreferences(stored, {});

    expect(merged).toEqual(stored);
    expect(merged).not.toBe(stored);
  });
});
