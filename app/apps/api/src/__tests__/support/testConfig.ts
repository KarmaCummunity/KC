import type { ApiConfig } from '../../platform/config/apiConfig';

/**
 * Nothing listens on port 1, so a connection attempt is refused at once:
 * the default test configuration can never reach a real service.
 */
export const UNREACHABLE_DATABASE_URL = 'postgres://kc:kc@127.0.0.1:1/kc';
export const UNREACHABLE_REDIS_URL = 'redis://127.0.0.1:1';

/** Issuer of the tokens the tests sign; no request is ever sent to it. */
export const TEST_AUTH_ISSUER = 'https://auth.kc.test/auth/v1';

/** A valid test configuration; pass only the fields a test cares about. */
export function testConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    environment: 'test',
    host: '127.0.0.1',
    port: 0,
    version: '9.9.9',
    databaseUrl: UNREACHABLE_DATABASE_URL,
    redisUrl: UNREACHABLE_REDIS_URL,
    authIssuer: TEST_AUTH_ISSUER,
    allowedOrigins: [],
    trustedProxyHops: 0,
    rateLimitPerMinute: 0,
    jobsToken: null,
    jobsScheduler: null,
    expoAccessToken: null,
    storage: { localDirectory: null, publicUrl: null, cloud: null },
    portRollout: {},
    appBaseUrl: null,
    whatsapp: { cloudApiToken: null, phoneNumberId: null, graphApiVersion: null, verifyToken: null, appSecret: null },
    translationProvider: 'googlefree',
    gemini: { apiKey: null, model: 'gemini-test' },
    postImport: { dailyBudget: 2000, model: 'gemini-test' },
    identityVerification: { apiKey: null, webhookSecret: null, workflowId: null, callbackUrl: null, identityHashKey: null },
    billing: { revenueCat: { webhookAuth: null, proEntitlementId: 'pro', orgEntitlementId: 'org' }, paymentWebhookSecrets: {} },
    ...overrides,
  };
}
