// DSN resolution: an EMPTY env var (unset CI variable) must fall back to the
// app.config default instead of disabling Sentry.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveDsn } from '../sentry';

describe('resolveDsn', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('prefers the build-time env var', () => {
    vi.stubEnv('EXPO_PUBLIC_SENTRY_DSN', ' https://env@host/1 ');
    expect(resolveDsn({ extra: { sentryDsn: 'https://cfg@host/2' } })).toBe('https://env@host/1');
  });

  it('falls back to the config default when the env var is empty', () => {
    vi.stubEnv('EXPO_PUBLIC_SENTRY_DSN', '');
    expect(resolveDsn({ extra: { sentryDsn: 'https://cfg@host/2' } })).toBe('https://cfg@host/2');
  });

  it('returns undefined when nothing is configured', () => {
    vi.stubEnv('EXPO_PUBLIC_SENTRY_DSN', '');
    expect(resolveDsn(undefined)).toBeUndefined();
  });
});
