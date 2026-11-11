import { describe, it, expect, vi } from 'vitest';
import { SupabaseOnlinePresence } from '../SupabaseOnlinePresence';

describe('SupabaseOnlinePresence (degraded: the baseline has no global presence topic, M24)', () => {
  it('tracks nobody: the online set stays empty after start', () => {
    const presence = new SupabaseOnlinePresence();

    presence.start('me');

    expect(presence.getSnapshot().size).toBe(0);
    expect(presence.isOnline('me')).toBe(false);
    expect(presence.isOnline(null)).toBe(false);
    expect(presence.isOnline(undefined)).toBe(false);
  });

  it('never calls a listener and unsubscribes cleanly', () => {
    const presence = new SupabaseOnlinePresence();
    const listener = vi.fn();

    const off = presence.subscribe(listener);
    presence.start('me');
    presence.stop();
    off();

    expect(listener).not.toHaveBeenCalled();
  });

  it('start and stop are safe to repeat', () => {
    const presence = new SupabaseOnlinePresence();

    expect(() => {
      presence.start('a');
      presence.start('a');
      presence.stop();
      presence.stop();
    }).not.toThrow();
  });
});
