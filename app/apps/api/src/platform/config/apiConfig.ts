/** Environments the API runs in. `test` is the in-process test run. */
export const API_ENVIRONMENTS = ['development', 'production', 'test'] as const;
export type ApiEnvironment = (typeof API_ENVIRONMENTS)[number];

/** Runtime configuration of the API process, read once at start. */
export interface ApiConfig {
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
}

/**
 * A configuration variable is missing or malformed.
 * The message names the variable and the rule, never the value: values of
 * later variables are secrets, and this message reaches the process log.
 */
export class ApiConfigError extends Error {
  constructor(
    readonly variable: string,
    reason: string,
  ) {
    super(`Invalid configuration: ${variable} ${reason}`);
    this.name = 'ApiConfigError';
  }
}

const DEFAULT_PORT = 8080;
const MAX_PORT = 65535;

/** Reads a variable; blank counts as unset, so `PORT=` falls back to the default. */
function readVariable(env: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === '' ? undefined : value;
}

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
export function loadApiConfig(env: Readonly<Record<string, string | undefined>>): ApiConfig {
  return {
    environment: parseEnvironment(readVariable(env, 'KC_API_ENVIRONMENT')),
    host: readVariable(env, 'KC_API_HOST') ?? '0.0.0.0',
    port: parsePort(readVariable(env, 'PORT')),
    version: readVariable(env, 'KC_APP_VERSION') ?? '0.0.0-dev',
    databaseUrl: parseServiceUrl('DATABASE_URL', readVariable(env, 'DATABASE_URL'), ['postgres', 'postgresql']),
    redisUrl: parseServiceUrl('REDIS_URL', readVariable(env, 'REDIS_URL'), ['redis', 'rediss']),
  };
}
