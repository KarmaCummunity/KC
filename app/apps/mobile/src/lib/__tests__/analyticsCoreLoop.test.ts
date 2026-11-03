import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: {} } },
}));

vi.mock('../observability/posthog', () => ({
  capturePosthog: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
  },
}));

describe('trackCoreLoop', () => {
  beforeEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('adds city segment from cityId', async () => {
    const { trackCoreLoop } = await import('../analyticsCoreLoop');
    const { capturePosthog } = await import('../observability/posthog');
    trackCoreLoop('listing_created', { world: 'items', cityId: '7000' });
    expect(capturePosthog).toHaveBeenCalledWith('listing_created', {
      world: 'items',
      city: 'lod',
    });
  });
});

describe('secondsSinceSignup', () => {
  it('returns whole seconds between account creation and now', async () => {
    const { secondsSinceSignup } = await import('../analyticsCoreLoop');
    const now = Date.parse('2026-10-30T12:00:30.900Z');
    expect(secondsSinceSignup('2026-10-30T12:00:00.000Z', now)).toBe(30);
  });

  it('returns null when the creation time is unknown, invalid or in the future', async () => {
    const { secondsSinceSignup } = await import('../analyticsCoreLoop');
    const now = Date.parse('2026-10-30T12:00:00.000Z');
    expect(secondsSinceSignup(null, now)).toBeNull();
    expect(secondsSinceSignup(undefined, now)).toBeNull();
    expect(secondsSinceSignup('not-a-date', now)).toBeNull();
    expect(secondsSinceSignup('2026-10-30T12:05:00.000Z', now)).toBeNull();
  });
});

describe('trackActivationIfFirst', () => {
  beforeEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('sends time-to-first-post as seconds_since_signup, never the raw timestamp', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-30T12:01:00.000Z'));
    const { trackActivationIfFirst } = await import('../analyticsCoreLoop');
    const { capturePosthog } = await import('../observability/posthog');
    await trackActivationIfFirst({ world: 'general', cityId: '7000', accountCreatedAt: '2026-10-30T12:00:00.000Z' });
    expect(capturePosthog).toHaveBeenCalledWith('activation', {
      world: 'general',
      city: 'lod',
      seconds_since_signup: 60,
    });
  });

  it('omits seconds_since_signup when the account creation time is unknown', async () => {
    const { trackActivationIfFirst } = await import('../analyticsCoreLoop');
    const { capturePosthog } = await import('../observability/posthog');
    await trackActivationIfFirst({ world: 'items', cityId: null, accountCreatedAt: null });
    const props = vi.mocked(capturePosthog).mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(props).not.toHaveProperty('seconds_since_signup');
    expect(props).not.toHaveProperty('accountCreatedAt');
  });
});
