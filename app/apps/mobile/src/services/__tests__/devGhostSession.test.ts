import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isDevGhostSessionEnabled, getDevGhostSession } from '../devGhostSession';

describe('devGhostSession', () => {
  const originalEnv = process.env.EXPO_PUBLIC_DEV_GHOST_SESSION;
  const originalDev = (globalThis as unknown as { __DEV__?: boolean }).__DEV__;

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as { __DEV__?: boolean }).__DEV__ = true;
    delete process.env.EXPO_PUBLIC_DEV_GHOST_SESSION;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.EXPO_PUBLIC_DEV_GHOST_SESSION = originalEnv;
    } else {
      delete process.env.EXPO_PUBLIC_DEV_GHOST_SESSION;
    }
    (globalThis as unknown as { __DEV__?: boolean }).__DEV__ = originalDev;
  });

  describe('isDevGhostSessionEnabled', () => {
    it('returns false when __DEV__ is false even if env flag is set', () => {
      (globalThis as unknown as { __DEV__?: boolean }).__DEV__ = false;
      process.env.EXPO_PUBLIC_DEV_GHOST_SESSION = '1';

      expect(isDevGhostSessionEnabled()).toBe(false);
    });

    it('returns false when env flag is not set or not 1', () => {
      expect(isDevGhostSessionEnabled()).toBe(false);

      process.env.EXPO_PUBLIC_DEV_GHOST_SESSION = '0';
      expect(isDevGhostSessionEnabled()).toBe(false);

      process.env.EXPO_PUBLIC_DEV_GHOST_SESSION = 'true';
      expect(isDevGhostSessionEnabled()).toBe(false);
    });

    it('returns true when __DEV__ is true and env flag is 1', () => {
      process.env.EXPO_PUBLIC_DEV_GHOST_SESSION = '1';
      expect(isDevGhostSessionEnabled()).toBe(true);
    });
  });

  describe('getDevGhostSession', () => {
    it('returns null when ghost session is not enabled', () => {
      expect(getDevGhostSession()).toBeNull();
    });

    it('returns a synthetic dev auth session when enabled', () => {
      process.env.EXPO_PUBLIC_DEV_GHOST_SESSION = '1';
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const session = getDevGhostSession();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[devGhostSession]'));
      expect(session).toEqual({
        userId: '00000000-0000-0000-0000-00000000dev0',
        email: 'ghost@dev.local',
        emailVerified: true,
        accessToken: 'dev-ghost-jwt-not-valid',
        refreshToken: 'dev-ghost-refresh-not-valid',
        expiresAt: expect.any(Number),
        displayName: 'Dev Ghost',
        avatarUrl: null,
      });
      expect(session!.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });
  });
});
