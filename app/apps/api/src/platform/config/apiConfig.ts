import { ApiConfigError, type Env, parseInteger, readVariable } from './configReader';
import { type FeatureConfig, loadFeatureConfig } from './featureConfig';

// The names other modules have always imported from here.
export { ApiConfigError } from './configReader';
export type { BillingConfig, GeminiConfig, IdentityVerificationConfig, PostImportConfig, TranslationProviderKind, WhatsAppConfig } from './featureConfig';

/** Environments the API runs in. `test` is the in-process test run. */
export const API_ENVIRONMENTS = ['development', 'production', 'test'] as const;
export type ApiEnvironment = (typeof API_ENVIRONMENTS)[number];

/** Runtime configuration of the API process, read once at start. The feature settings are in `featureConfig.ts`. */
export interface ApiConfig extends FeatureConfig {
  readonly environment: ApiEnvironment;
  /** Network interface to bind. A container must bind every interface. */
  readonly host: string;
  readonly port: number;
  /** App version reported by the health endpoint (`app/VERSION` at build time). */
  readonly version: string;
  /** Postgres connection string. A secret: never logged, never in an error. */
  readonly databaseUrl: string;
  /** Redis connection string. A secret, like `databaseUrl`. */
  readonly redisUrl: string;
  /**
   * Issuer of the access tokens the API accepts, exactly as in the token's
   * `iss` claim. Its signing keys are read from `<issuer>/.well-known/jwks.json`.
   */
  readonly authIssuer: string;
  /**
   * Web origins allowed to call the API from a browser (CORS). Empty: no
   * browser may; the native apps are not subject to CORS and need no entry.
   */
  readonly allowedOrigins: readonly string[];
  /**
   * Reverse proxies in front of the API whose `X-Forwarded-For` entry is
   * trusted when working out the client address. 0: use the socket address.
   */
  readonly trustedProxyHops: number;
  /** Port calls one caller (a member, or an address when signed out) may make per minute. 0: no limit. */
  readonly rateLimitPerMinute: number;
  /**
   * The bearer token a scheduler sends to start a job (`POST /v1/jobs/<name>`).
   * A secret. Null: no job can be started over HTTP.
   */
  readonly jobsToken: string | null;
  /** Access token of the Expo push service, when the Expo project requires one. A secret. */
  readonly expoAccessToken: string | null;
}

const DEFAULT_PORT = 8080;
/** Ten calls a second, sustained: far above what a screen needs, far below a scraper. */
const DEFAULT_RATE_LIMIT_PER_MINUTE = 600;
const MAX_PORT = 65535;
/** Shorter than this, a token could be guessed. */
const MIN_JOBS_TOKEN_LENGTH = 32;

function parseEnvironment(value: string | undefined): ApiEnvironment {
  if (value === undefined) return 'development';
  const environment = API_ENVIRONMENTS.find((candidate) => candidate === value);
  if (!environment) {
    throw new ApiConfigError('KC_API_ENVIRONMENT', `must be one of: ${API_ENVIRONMENTS.join(', ')}`);
  }
  return environment;
}

function parsePort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PORT;
  // Digits only: `Number()` would also accept "1e3", "0x50" and " 80 ".
  const port = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    throw new ApiConfigError('PORT', `must be an integer between 1 and ${MAX_PORT}`);
  }
  return port;
}

/**
 * Reads a comma-separated list of web origins. Each must be exactly an origin
 * (`https://app.example.org`): a path, a trailing slash or a wildcard would
 * make the CORS rule match more, or less, than its author meant.
 */
function parseOrigins(variable: string, value: string | undefined): string[] {
  if (value === undefined) return [];
  return value.split(',').map((entry) => {
    const origin = entry.trim();
    if (!URL.canParse(origin) || new URL(origin).origin !== origin) {
      throw new ApiConfigError(variable, 'must be a comma-separated list of origins such as https://app.example.org');
    }
    return origin;
  });
}

/** Reads the jobs token. A short one is a start-up error, not a weak lock found later. */
function parseJobsToken(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (value.length < MIN_JOBS_TOKEN_LENGTH) throw new ApiConfigError('KC_JOBS_TOKEN', `must be at least ${MIN_JOBS_TOKEN_LENGTH} characters`);
  return value;
}

/**
 * Reads a required connection string and checks its shape only (it is a URL
 * with one of the expected schemes). Whether the service answers is the
 * readiness endpoint's job, not start-up's.
 */
function parseServiceUrl(variable: string, value: string | undefined, schemes: readonly string[]): string {
  const expectation = `must be a URL starting with ${schemes.map((scheme) => `${scheme}://`).join(' or ')}`;
  if (value === undefined) throw new ApiConfigError(variable, `is required and ${expectation}`);
  if (!URL.canParse(value) || !schemes.includes(new URL(value).protocol.slice(0, -1))) {
    throw new ApiConfigError(variable, expectation);
  }
  return value;
}

/**
 * Builds the API configuration from environment variables.
 * `PORT` is the name Cloud Run injects; the others are KC's own.
 * @throws ApiConfigError on the first invalid variable, so a misconfigured
 *   process stops at start instead of failing on its first request.
 */
export function loadApiConfig(env: Env): ApiConfig {
  return {
    environment: parseEnvironment(readVariable(env, 'KC_API_ENVIRONMENT')),
    host: readVariable(env, 'KC_API_HOST') ?? '0.0.0.0',
    port: parsePort(readVariable(env, 'PORT')),
    version: readVariable(env, 'KC_APP_VERSION') ?? '0.0.0-dev',
    databaseUrl: parseServiceUrl('DATABASE_URL', readVariable(env, 'DATABASE_URL'), ['postgres', 'postgresql']),
    redisUrl: parseServiceUrl('REDIS_URL', readVariable(env, 'REDIS_URL'), ['redis', 'rediss']),
    authIssuer: parseServiceUrl('KC_AUTH_ISSUER', readVariable(env, 'KC_AUTH_ISSUER'), ['https', 'http']),
    allowedOrigins: parseOrigins('KC_API_ALLOWED_ORIGINS', readVariable(env, 'KC_API_ALLOWED_ORIGINS')),
    trustedProxyHops: parseInteger('KC_API_TRUSTED_PROXY_HOPS', readVariable(env, 'KC_API_TRUSTED_PROXY_HOPS'), 0, 0, 10),
    rateLimitPerMinute: parseInteger('KC_API_RATE_LIMIT_PER_MINUTE', readVariable(env, 'KC_API_RATE_LIMIT_PER_MINUTE'), DEFAULT_RATE_LIMIT_PER_MINUTE, 0, 100_000),
    jobsToken: parseJobsToken(readVariable(env, 'KC_JOBS_TOKEN')),
    expoAccessToken: readVariable(env, 'EXPO_ACCESS_TOKEN') ?? null,
    ...loadFeatureConfig(env),
  };
}
