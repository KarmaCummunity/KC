import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: {} } },
}));

vi.mock('../observability/posthog', () => ({
  capturePosthog: vi.fn(),
}));

describe('track()', () => {
  beforeEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('accepts funnel event names without throwing', async () => {
    const { track } = await import('../analytics');
    const { capturePosthog } = await import('../observability/posthog');
    expect(() => track('signup', { method: 'email' })).not.toThrow();
    expect(() => track('listing_created', { world: 'items' })).not.toThrow();
    expect(() => track('match_made', { world: 'items' })).not.toThrow();
    expect(() => track('donation', { channel: 'money' })).not.toThrow();
    expect(() => track('activation', { world: 'items', city: 'lod' })).not.toThrow();
    expect(() => track('match_feedback', { response: 'accept', world: 'food', city: 'other' })).not.toThrow();
    expect(capturePosthog).toHaveBeenCalledWith('signup', { method: 'email' });
    expect(capturePosthog).toHaveBeenCalledWith('donation', { channel: 'money' });
  });
});
