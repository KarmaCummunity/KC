import { describe, it, expect } from 'vitest';
import type { NotificationPreferences } from '@kc/domain';
import { applyNotificationPreferencesPatch } from '../applyNotificationPreferencesPatch';

const base: NotificationPreferences = {
  critical: true,
  social: true,
  kinds: { match_suggested: false, follow_started: false },
};

describe('applyNotificationPreferencesPatch', () => {
  it('replaces top-level toggles and keeps the kinds map', () => {
    expect(applyNotificationPreferencesPatch(base, { social: false })).toEqual({
      ...base,
      social: false,
    });
  });

  it('merges kinds per key so other opt-outs survive', () => {
    const next = applyNotificationPreferencesPatch(base, { kinds: { match_suggested: true } });
    expect(next.kinds).toEqual({ match_suggested: true, follow_started: false });
  });

  it('creates the kinds map on a legacy row that has none', () => {
    const legacy: NotificationPreferences = { critical: true, social: true };
    expect(applyNotificationPreferencesPatch(legacy, { kinds: { match_suggested: false } })).toEqual({
      critical: true,
      social: true,
      kinds: { match_suggested: false },
    });
  });

  it('does not mutate the current preferences', () => {
    applyNotificationPreferencesPatch(base, { kinds: { match_suggested: true } });
    expect(base.kinds?.match_suggested).toBe(false);
  });
});
