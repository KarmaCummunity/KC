import { ApiConfigError, type Env, parseInteger, readVariable } from './configReader';
import { type FeatureConfig, loadFeatureConfig } from './featureConfig';

// The names other modules have always imported from here.
export { ApiConfigError } from './configReader';
export type { BillingConfig, CloudStorageConfig, GeminiConfig, IdentityVerificationConfig, PostImportConfig, StorageConfig, TranslationProviderKind, WhatsAppConfig } from './featureConfig';

/** Environments the API runs in. `test` is the in-process test run. */
export const API_ENVIRONMENTS = ['development', 'production', 'test'] as const;
export type ApiEnvironment = (typeof API_ENVIRONMENTS)[number];

/** Runtime configuration of the API process, read once at start. The feature settings are in `featureConfig.ts`. */
/** The scheduler that starts jobs with its own Google identity instead of a shared secret. */
export interface JobsSchedulerConfig {
  /** The audience the scheduler's identity tokens are issued for: a name the scheduler and this API agree on. */
  readonly audience: string;
  /** Email address of the scheduler's service account; a token of any other account is refused. */
  readonly serviceAccount: string;
}

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
  /**
   * Null: this process is the whole server (`KC_API_SINGLE_INSTANCE=1`), and what Redis
   * shares between instances (rate counters, realtime fan-out, the visitor cache) is kept in it.
   */
  readonly redisUrl: string | null;
  /**
   * Issuer of the access tokens the API accepts, exactly as in the token's
   * `iss` claim. Its signing keys are read from `<issuer>/.well-known/jwks.json`.
   */
  readonly authIssuer: string;
  /**
   * The private keys KC signs its own access tokens with, as a JWK Set
   * (ADR-013). A secret. Null: the API issues no tokens and accepts the ones
   * of the issuer above, verified against that issuer's published keys.
   */
  readonly authSigningKeys: string | null;
  /**
   * The addresses a link in an identity email (verification, password reset)
   * may lead to, exactly. A request that names any other address is refused:
   * the link carries a secret, and must only ever open the app.
   */
  readonly authRedirectUrls: readonly string[];
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
  /** The scheduler whose own Google identity starts jobs. Null: only the jobs token does. */
  readonly jobsScheduler: JobsSchedulerConfig | null;
  /** Access token of the Expo push service, when the Expo project requires one. A secret. */
  readonly expoAccessToken: string | null;
}

const DEFAULT_PORT = 8080;
/** Ten calls a second, sustained: far above what a screen needs, far below a scraper. */
const DEFAULT_RATE_LIMIT_PER_MINUTE = 600;
const MAX_PORT = 65535;
/** Shorter than this, a token could be guessed. */
const MIN_JOBS_TOKEN_LENGTH = 32;
/** A service account's address: a name at a project's `iam.gserviceaccount.com` domain (or Google's own, for its agents). */
const SERVICE_ACCOUNT_EMAIL = /^[a-z0-9-]+@[a-z0-9.-]+\.gserviceaccount\.com$/;

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

/**
 * Reads where Redis is. Running without it is allowed only when declared: a
 * server of several instances that silently kept its counters and its
 * realtime fan-out per instance would look healthy and be wrong.
 */
function parseRedisUrl(env: Env): string | null {
  const value = readVariable(env, 'REDIS_URL');
  if (value !== undefined) return parseServiceUrl('REDIS_URL', value, ['redis', 'rediss']);
  if (readVariable(env, 'KC_API_SINGLE_INSTANCE') === '1') return null;
  throw new ApiConfigError('REDIS_URL', 'is required, unless KC_API_SINGLE_INSTANCE=1 declares that one process is the whole server');
}

/**
 * Reads the scheduler's identity: both variables or neither. An audience with
 * no account would accept a token of anyone at Google, so half a
 * configuration is a start-up error.
 */
function parseJobsScheduler(env: Env): JobsSchedulerConfig | null {
  const audience = readVariable(env, 'KC_JOBS_OIDC_AUDIENCE');
  const serviceAccount = readVariable(env, 'KC_JOBS_SERVICE_ACCOUNT');
  if (audience === undefined && serviceAccount === undefined) return null;
  if (audience === undefined) throw new ApiConfigError('KC_JOBS_OIDC_AUDIENCE', 'is required when KC_JOBS_SERVICE_ACCOUNT is set');
  if (serviceAccount === undefined) throw new ApiConfigError('KC_JOBS_SERVICE_ACCOUNT', 'is required when KC_JOBS_OIDC_AUDIENCE is set');
  if (!SERVICE_ACCOUNT_EMAIL.test(serviceAccount)) throw new ApiConfigError('KC_JOBS_SERVICE_ACCOUNT', 'must be the email address of a Google service account');
  return { audience, serviceAccount };
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

/** Path, under the API's address, of the routes that make it an issuer; its key set is published below it. */
export const OWN_ISSUER_PATH = '/v1/auth';

/**
 * The keys are only read as text here; they are parsed when the process
 * starts its identity module. An API that signs tokens is their issuer, so
 * the issuer must be this API's own identity address: the verifier of any
 * other service looks for the key set there.
 */
function parseAuthSigningKeys(env: Env): string | null {
  const keys = readVariable(env, 'KC_AUTH_SIGNING_KEYS') ?? null;
  if (keys !== null && !readVariable(env, 'KC_AUTH_ISSUER')?.endsWith(OWN_ISSUER_PATH)) {
    throw new ApiConfigError('KC_AUTH_ISSUER', `must be this API's address followed by ${OWN_ISSUER_PATH} when KC_AUTH_SIGNING_KEYS is set`);
  }
  return keys;
}

/** A comma-separated list of absolute URLs (a web page of the app, or the app's own scheme). */
function parseAuthRedirectUrls(value: string | undefined): readonly string[] {
  const urls = (value ?? '').split(',').map((url) => url.trim()).filter((url) => url !== '');
  if (!urls.every((url) => URL.canParse(url))) throw new ApiConfigError('KC_AUTH_REDIRECT_URLS', 'must be a comma-separated list of URLs');
  return urls;
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
    redisUrl: parseRedisUrl(env),
    authIssuer: parseServiceUrl('KC_AUTH_ISSUER', readVariable(env, 'KC_AUTH_ISSUER'), ['https', 'http']),
    authSigningKeys: parseAuthSigningKeys(env),
    authRedirectUrls: parseAuthRedirectUrls(readVariable(env, 'KC_AUTH_REDIRECT_URLS')),
    allowedOrigins: parseOrigins('KC_API_ALLOWED_ORIGINS', readVariable(env, 'KC_API_ALLOWED_ORIGINS')),
    trustedProxyHops: parseInteger('KC_API_TRUSTED_PROXY_HOPS', readVariable(env, 'KC_API_TRUSTED_PROXY_HOPS'), 0, 0, 10),
    rateLimitPerMinute: parseInteger('KC_API_RATE_LIMIT_PER_MINUTE', readVariable(env, 'KC_API_RATE_LIMIT_PER_MINUTE'), DEFAULT_RATE_LIMIT_PER_MINUTE, 0, 100_000),
    jobsToken: parseJobsToken(readVariable(env, 'KC_JOBS_TOKEN')),
    jobsScheduler: parseJobsScheduler(env),
    expoAccessToken: readVariable(env, 'EXPO_ACCESS_TOKEN') ?? null,
    ...loadFeatureConfig(env),
  };
}
