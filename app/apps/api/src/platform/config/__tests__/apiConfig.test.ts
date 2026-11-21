import { describe, expect, it } from 'vitest';
import { ApiConfigError, loadApiConfig } from '../apiConfig';

/** Runs the loader and returns the configuration error it must throw. */
function configErrorOf(env: Record<string, string>): ApiConfigError {
  try {
    loadApiConfig(env);
  } catch (error) {
    if (error instanceof ApiConfigError) return error;
    throw error;
  }
  throw new Error('expected loadApiConfig to throw');
}

describe('loadApiConfig', () => {
  it('reads every variable', () => {
    const config = loadApiConfig({
      KC_API_ENVIRONMENT: 'production',
      KC_API_HOST: '127.0.0.1',
      PORT: '3000',
      KC_APP_VERSION: '1.9.260',
    });

    expect(config).toEqual({ environment: 'production', host: '127.0.0.1', port: 3000, version: '1.9.260' });
  });

  it('falls back to development defaults when nothing is set', () => {
    expect(loadApiConfig({})).toEqual({
      environment: 'development',
      host: '0.0.0.0',
      port: 8080,
      version: '0.0.0-dev',
    });
  });

  it('treats a blank variable as unset', () => {
    expect(loadApiConfig({ PORT: '  ', KC_API_ENVIRONMENT: '' })).toMatchObject({
      port: 8080,
      environment: 'development',
    });
  });

  it('accepts the lowest and highest port', () => {
    expect(loadApiConfig({ PORT: '1' }).port).toBe(1);
    expect(loadApiConfig({ PORT: '65535' }).port).toBe(65535);
  });

  it.each(['0', '65536', '-1', '80.5', '1e3', '0x50', 'http'])('rejects PORT=%s', (port) => {
    expect(configErrorOf({ PORT: port }).variable).toBe('PORT');
  });

  it('rejects an unknown environment and lists the allowed ones', () => {
    const error = configErrorOf({ KC_API_ENVIRONMENT: 'staging' });

    expect(error.variable).toBe('KC_API_ENVIRONMENT');
    expect(error.message).toContain('development, production, test');
  });

  it('names the variable but never prints its value', () => {
    const error = configErrorOf({ PORT: 'secret-looking-value' });

    expect(error.message).toContain('PORT');
    expect(error.message).not.toContain('secret-looking-value');
  });
});
