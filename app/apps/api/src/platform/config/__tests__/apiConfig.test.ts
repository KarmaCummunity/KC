import { describe, expect, it } from 'vitest';
import { ApiConfigError, loadApiConfig } from '../apiConfig';

/** The two required variables; every case adds or overrides on top of them. */
const REQUIRED = {
  DATABASE_URL: 'postgresql://user:pass@db.internal:5432/kc',
  REDIS_URL: 'rediss://cache.internal:6379',
  KC_AUTH_ISSUER: 'https://auth.internal/auth/v1',
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
      authIssuer: REQUIRED.KC_AUTH_ISSUER,
      allowedOrigins: [],
      trustedProxyHops: 0,
      rateLimitPerMinute: 600,
      translationProvider: 'googlefree',
      gemini: { apiKey: null, model: 'gemini-2.0-flash' },
      postImport: { dailyBudget: 2000, model: 'gemini-2.0-flash' },
      identityVerification: { apiKey: null, webhookSecret: null, workflowId: null, callbackUrl: null, identityHashKey: null },
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

  it.each(['DATABASE_URL', 'REDIS_URL', 'KC_AUTH_ISSUER'])('requires %s', (variable) => {
    const error = configErrorOf({ [variable]: '' });

    expect(error.variable).toBe(variable);
    expect(error.message).toContain('is required');
  });

  it.each([
    ['DATABASE_URL', 'mysql://user:pass@db.internal/kc'],
    ['DATABASE_URL', 'db.internal:5432/kc'],
    ['REDIS_URL', 'http://cache.internal:6379'],
    ['REDIS_URL', 'not a url'],
    ['KC_AUTH_ISSUER', 'ftp://auth.internal/auth/v1'],
  ])('rejects a malformed %s without printing it', (variable, value) => {
    const error = configErrorOf({ [variable]: value });

    expect(error.variable).toBe(variable);
    expect(error.message).not.toContain(value);
  });

  it('accepts both spellings of each scheme', () => {
    const config = loadApiConfig({
      ...REQUIRED,
      DATABASE_URL: 'postgres://db.internal/kc',
      REDIS_URL: 'redis://cache.internal',
    });

    expect(config.databaseUrl).toBe('postgres://db.internal/kc');
    expect(config.redisUrl).toBe('redis://cache.internal');
  });

  it('reads the browser origins, proxy hops and rate limit', () => {
    const config = loadApiConfig({
      ...REQUIRED,
      KC_API_ALLOWED_ORIGINS: 'https://app.kc.test, http://localhost:8081',
      KC_API_TRUSTED_PROXY_HOPS: '1',
      KC_API_RATE_LIMIT_PER_MINUTE: '0',
    });

    expect(config).toMatchObject({
      allowedOrigins: ['https://app.kc.test', 'http://localhost:8081'],
      trustedProxyHops: 1,
      rateLimitPerMinute: 0,
    });
  });

  it.each([
    ['KC_API_ALLOWED_ORIGINS', 'https://app.kc.test/'],
    ['KC_API_ALLOWED_ORIGINS', 'https://app.kc.test/path'],
    ['KC_API_ALLOWED_ORIGINS', '*'],
    ['KC_API_ALLOWED_ORIGINS', 'app.kc.test'],
    ['KC_API_TRUSTED_PROXY_HOPS', '11'],
    ['KC_API_TRUSTED_PROXY_HOPS', '-1'],
    ['KC_API_RATE_LIMIT_PER_MINUTE', 'many'],
  ])('rejects %s=%s', (variable, value) => {
    expect(configErrorOf({ [variable]: value }).variable).toBe(variable);
  });

  it('reads the translation provider and the Gemini settings', () => {
    const config = loadApiConfig({ ...REQUIRED, KC_TRANSLATION_PROVIDER: 'Gemini', GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'gemini-test' });

    expect(config).toMatchObject({ translationProvider: 'gemini', gemini: { apiKey: 'test-key', model: 'gemini-test' } });
  });

  it('reads the post import budget and model; the model defaults to the Gemini model', () => {
    const tuned = loadApiConfig({ ...REQUIRED, GEMINI_MODEL: 'gemini-test', KC_IMPORT_DAILY_BUDGET: '50', KC_IMPORT_MODEL: 'gemini-import' });

    expect(tuned.postImport).toEqual({ dailyBudget: 50, model: 'gemini-import' });
    expect(loadApiConfig({ ...REQUIRED, GEMINI_MODEL: 'gemini-test' }).postImport.model).toBe('gemini-test');
    expect(configErrorOf({ KC_IMPORT_DAILY_BUDGET: 'lots' }).variable).toBe('KC_IMPORT_DAILY_BUDGET');
  });

  it('reads the identity verification settings and accepts only the provider it has an adapter for', () => {
    const config = loadApiConfig({
      ...REQUIRED,
      IDV_PROVIDER: 'didit',
      IDV_PROVIDER_API_KEY: 'api-key',
      IDV_WEBHOOK_SECRET: 'webhook-secret',
      IDV_DIDIT_WORKFLOW_ID: 'workflow-1',
      IDV_CALLBACK_URL: 'https://app.kc.test/verified',
      IDV_IDENTITY_HASH_KEY: 'hash-key',
    });

    expect(config.identityVerification).toEqual({
      apiKey: 'api-key',
      webhookSecret: 'webhook-secret',
      workflowId: 'workflow-1',
      callbackUrl: 'https://app.kc.test/verified',
      identityHashKey: 'hash-key',
    });
    expect(configErrorOf({ IDV_PROVIDER: 'other' }).variable).toBe('IDV_PROVIDER');
    expect(configErrorOf({ IDV_CALLBACK_URL: 'not a url' }).variable).toBe('IDV_CALLBACK_URL');
  });

  it('refuses to start with Gemini selected and no key, or with an unknown provider', () => {
    expect(configErrorOf({ KC_TRANSLATION_PROVIDER: 'gemini' }).variable).toBe('GEMINI_API_KEY');
    expect(configErrorOf({ KC_TRANSLATION_PROVIDER: 'babelfish' }).variable).toBe('KC_TRANSLATION_PROVIDER');
  });

  it('names the variable but never prints its value', () => {
    const error = configErrorOf({ PORT: 'secret-looking-value' });

    expect(error.message).toContain('PORT');
    expect(error.message).not.toContain('secret-looking-value');
  });
});
