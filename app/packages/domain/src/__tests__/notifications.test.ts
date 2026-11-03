import { describe, it, expect } from 'vitest';
import { isNotificationKindEnabled } from '../notifications';

describe('isNotificationKindEnabled', () => {
  it('treats a missing preferences object as enabled', () => {
    expect(isNotificationKindEnabled(null, 'match_suggested')).toBe(true);
    expect(isNotificationKindEnabled(undefined, 'match_suggested')).toBe(true);
  });

  it('treats legacy rows without a kinds map as enabled', () => {
    expect(isNotificationKindEnabled({}, 'match_suggested')).toBe(true);
  });

  it('is disabled only by an explicit false for that kind', () => {
    const prefs = { kinds: { match_suggested: false } };
    expect(isNotificationKindEnabled(prefs, 'match_suggested')).toBe(false);
    expect(isNotificationKindEnabled(prefs, 'match_accepted')).toBe(true);
  });

  it('is enabled by an explicit true', () => {
    expect(isNotificationKindEnabled({ kinds: { match_suggested: true } }, 'match_suggested')).toBe(true);
  });
});
