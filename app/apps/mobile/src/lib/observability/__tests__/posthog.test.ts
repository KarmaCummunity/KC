import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: {} } },
}));

describe('posthog observability', () => {
  beforeEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  });

  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('hasPosthogKey is false without EXPO_PUBLIC_POSTHOG_KEY', async () => {
    vi.stubEnv('EXPO_PUBLIC_POSTHOG_KEY', '');
    const mod = await import('../posthog');
    expect(mod.hasPosthogKey()).toBe(false);
    await mod.initPosthog();
    expect(mod.isPosthogInitialised()).toBe(false);
    expect(mod.getPosthogIfInit()).toBeNull();
  });

  it('capturePosthog is a no-op when not initialised', async () => {
    vi.stubEnv('EXPO_PUBLIC_POSTHOG_KEY', '');
    const mod = await import('../posthog');
    expect(() => mod.capturePosthog('signup', { method: 'email' })).not.toThrow();
  });

  it('registers environment super property from EXPO_PUBLIC_ENVIRONMENT', async () => {
    const register = vi.fn();
    vi.doMock('posthog-react-native', () => ({
      PostHog: class {
        capture() {}
        screen() {
          return Promise.resolve();
        }
        identify() {}
        reset() {}
        register = register;
      },
    }));
    vi.stubEnv('EXPO_PUBLIC_POSTHOG_KEY', 'phc_test');
    vi.stubEnv('EXPO_PUBLIC_ENVIRONMENT', 'development');
    const mod = await import('../posthog');
    await mod.initPosthog();
    expect(mod.isPosthogInitialised()).toBe(true);
    expect(register).toHaveBeenCalledWith({ environment: 'development' });
  });

  it('registers environment=production when EXPO_PUBLIC_ENVIRONMENT is unset', async () => {
    const register = vi.fn();
    vi.doMock('posthog-react-native', () => ({
      PostHog: class {
        capture() {}
        screen() {
          return Promise.resolve();
        }
        identify() {}
        reset() {}
        register = register;
      },
    }));
    vi.stubEnv('EXPO_PUBLIC_POSTHOG_KEY', 'phc_test');
    vi.stubEnv('EXPO_PUBLIC_ENVIRONMENT', '');
    const mod = await import('../posthog');
    await mod.initPosthog();
    expect(register).toHaveBeenCalledWith({ environment: 'production' });
  });
});
