import { describe, expect, it } from 'vitest';
import { ApiConfigError, loadApiConfig } from '../apiConfig';

/** The two required variables; every case adds or overrides on top of them. */
const REQUIRED = {
  DATABASE_URL: 'postgresql://user:pass@db.internal:5432/kc',
  REDIS_URL: 'rediss://cache.internal:6379',
};

/** Runs the loader and returns the configuration error it must throw. */
function configErrorOf(env: Record<string, string>): ApiConfigError {
  try {
    loadApiConfig({ ...REQUIRED, ...env });
  } catch (error) {
    if (error instanceof ApiConfigError) return error;
    throw error;
  }
  throw new Error('expected loadApiConfig to throw');
}

describe('loadApiConfig', () => {
  it('reads every variable', () => {
    const config = loadApiConfig({
      ...REQUIRED,
      KC_API_ENVIRONMENT: 'production',
      KC_API_HOST: '127.0.0.1',
      PORT: '3000',
      KC_APP_VERSION: '1.9.260',
    });

    expect(config).toEqual({
      environment: 'production',
      host: '127.0.0.1',
      port: 3000,
      version: '1.9.260',
      databaseUrl: REQUIRED.DATABASE_URL,
      redisUrl: REQUIRED.REDIS_URL,
    });
  });

  it('falls back to development defaults when only the required variables are set', () => {
    expect(loadApiConfig(REQUIRED)).toMatchObject({
      environment: 'development',
      host: '0.0.0.0',
      port: 8080,
      version: '0.0.0-dev',
    });
  });

  it('treats a blank variable as unset', () => {
    expect(loadApiConfig({ ...REQUIRED, PORT: '  ', KC_API_ENVIRONMENT: '' })).toMatchObject({
      port: 8080,
      environment: 'development',
    });
  });

  it('accepts the lowest and highest port', () => {
    expect(loadApiConfig({ ...REQUIRED, PORT: '1' }).port).toBe(1);
    expect(loadApiConfig({ ...REQUIRED, PORT: '65535' }).port).toBe(65535);
  });

  it.each(['0', '65536', '-1', '80.5', '1e3', '0x50', 'http'])('rejects PORT=%s', (port) => {
    expect(configErrorOf({ PORT: port }).variable).toBe('PORT');
  });

  it('rejects an unknown environment and lists the allowed ones', () => {
    const error = configErrorOf({ KC_API_ENVIRONMENT: 'staging' });

    expect(error.variable).toBe('KC_API_ENVIRONMENT');
    expect(error.message).toContain('development, production, test');
  });

  it.each(['DATABASE_URL', 'REDIS_URL'])('requires %s', (variable) => {
    const error = configErrorOf({ [variable]: '' });

    expect(error.variable).toBe(variable);
    expect(error.message).toContain('is required');
  });

  it.each([
    ['DATABASE_URL', 'mysql://user:pass@db.internal/kc'],
    ['DATABASE_URL', 'db.internal:5432/kc'],
    ['REDIS_URL', 'http://cache.internal:6379'],
    ['REDIS_URL', 'not a url'],
  ])('rejects a malformed %s without printing it', (variable, value) => {
    const error = configErrorOf({ [variable]: value });

    expect(error.variable).toBe(variable);
    expect(error.message).not.toContain(value);
  });

  it('accepts both spellings of each scheme', () => {
    const config = loadApiConfig({ DATABASE_URL: 'postgres://db.internal/kc', REDIS_URL: 'redis://cache.internal' });

    expect(config.databaseUrl).toBe('postgres://db.internal/kc');
    expect(config.redisUrl).toBe('redis://cache.internal');
  });

  it('names the variable but never prints its value', () => {
    const error = configErrorOf({ PORT: 'secret-looking-value' });

    expect(error.message).toContain('PORT');
    expect(error.message).not.toContain('secret-looking-value');
  });
});
