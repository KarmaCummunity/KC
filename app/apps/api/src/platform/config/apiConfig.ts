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
  /** Who translates member content (FR-TRANSLATE-002). */
  readonly translationProvider: TranslationProviderKind;
  /** Google Gemini: translation when it is the selected provider, and the other AI features as they move here. */
  readonly gemini: GeminiConfig;
  /** The external post import (FR-IMPORT-008). */
  readonly postImport: PostImportConfig;
  /** Identity verification by the Didit provider (FR-VERIFY-010). */
  readonly identityVerification: IdentityVerificationConfig;
  /** The billing providers' webhooks. */
  readonly billing: BillingConfig;
}

export interface BillingConfig {
  readonly revenueCat: {
    /** The shared secret RevenueCat sends in its Authorization header. A secret; null: every event is refused. */
    readonly webhookAuth: string | null;
    /** RevenueCat entitlement of a member's Pro tier. */
    readonly proEntitlementId: string;
    /** RevenueCat entitlement of an organization's paid plan. */
    readonly orgEntitlementId: string;
  };
  /** Signing secret of each payment provider, by provider slug. Secrets; a provider without one is refused. */
  readonly paymentWebhookSecrets: Readonly<Record<string, string>>;
}

/**
 * Every field is null until configured. Without the key or the workflow no
 * session can be opened; without the webhook secret every provider event is
 * refused; without the hash key no approval can be applied.
 */
export interface IdentityVerificationConfig {
  /** The provider's API key. A secret. */
  readonly apiKey: string | null;
  /** Shared secret of the provider's event signature. A secret. */
  readonly webhookSecret: string | null;
  /** The verification workflow configured in the provider's console. */
  readonly workflowId: string | null;
  /** Where the hosted flow sends the member when done. */
  readonly callbackUrl: string | null;
  /** Key of the hash that recognizes one document across accounts. A secret; changing it orphans existing hashes. */
  readonly identityHashKey: string | null;
}

export interface PostImportConfig {
  /** Model calls the whole service may make per UTC day; past it, imports fall back to the manual route. */
  readonly dailyBudget: number;
  /** The Gemini model that reads shared messages. */
  readonly model: string;
}

/** `googlefree`: Google's keyless public endpoint, no cost. `gemini`: Gemini Flash, needs `GEMINI_API_KEY`. */
export const TRANSLATION_PROVIDERS = ['googlefree', 'gemini'] as const;
export type TranslationProviderKind = (typeof TRANSLATION_PROVIDERS)[number];

export interface GeminiConfig {
  /** The API key, or null when none is configured. A secret: never logged, never in an error. */
  readonly apiKey: string | null;
  readonly model: string;
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
/** Ten calls a second, sustained: far above what a screen needs, far below a scraper. */
const DEFAULT_RATE_LIMIT_PER_MINUTE = 600;
const MAX_PORT = 65535;
const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';
const DEFAULT_IMPORT_DAILY_BUDGET = 2000;

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

/** Reads an optional whole number within a range. */
function parseInteger(variable: string, value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ApiConfigError(variable, `must be an integer between ${min} and ${max}`);
  }
  return parsed;
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

/** One variable per payment provider: `PAYMENTS_WEBHOOK_SECRET_<PROVIDER SLUG IN UPPER CASE>`. */
const PAYMENT_SECRET_PREFIX = 'PAYMENTS_WEBHOOK_SECRET_';

function parseBilling(env: Readonly<Record<string, string | undefined>>): BillingConfig {
  const paymentWebhookSecrets: Record<string, string> = {};
  for (const name of Object.keys(env)) {
    const slug = name.startsWith(PAYMENT_SECRET_PREFIX) ? name.slice(PAYMENT_SECRET_PREFIX.length).toLowerCase() : '';
    const secret = readVariable(env, name);
    // Only a plain slug is a provider; anything else is not a variable of this family.
    if (secret !== undefined && /^[a-z][a-z0-9_]{0,40}$/.test(slug)) paymentWebhookSecrets[slug] = secret;
  }
  return {
    revenueCat: {
      webhookAuth: readVariable(env, 'REVENUECAT_WEBHOOK_AUTH') ?? null,
      proEntitlementId: readVariable(env, 'REVENUECAT_PRO_ENTITLEMENT_ID') ?? 'pro',
      orgEntitlementId: readVariable(env, 'REVENUECAT_ORG_ENTITLEMENT_ID') ?? 'org',
    },
    paymentWebhookSecrets,
  };
}

/** The one identity provider the server has an adapter for. */
const IDENTITY_PROVIDER_SLUG = 'didit';

function parseIdentityVerification(env: Readonly<Record<string, string | undefined>>): IdentityVerificationConfig {
  const provider = readVariable(env, 'IDV_PROVIDER');
  if (provider !== undefined && provider !== IDENTITY_PROVIDER_SLUG) throw new ApiConfigError('IDV_PROVIDER', `must be ${IDENTITY_PROVIDER_SLUG}`);
  const callbackUrl = readVariable(env, 'IDV_CALLBACK_URL') ?? null;
  if (callbackUrl !== null && !URL.canParse(callbackUrl)) throw new ApiConfigError('IDV_CALLBACK_URL', 'must be a URL');
  return {
    apiKey: readVariable(env, 'IDV_PROVIDER_API_KEY') ?? null,
    webhookSecret: readVariable(env, 'IDV_WEBHOOK_SECRET') ?? null,
    workflowId: readVariable(env, 'IDV_DIDIT_WORKFLOW_ID') ?? null,
    callbackUrl,
    identityHashKey: readVariable(env, 'IDV_IDENTITY_HASH_KEY') ?? null,
  };
}

/**
 * Reads who translates. Selecting Gemini without its key is a start-up error:
 * otherwise every translation would fail at request time instead.
 */
function parseTranslationProvider(value: string | undefined, geminiApiKey: string | null): TranslationProviderKind {
  if (value === undefined) return 'googlefree';
  const provider = TRANSLATION_PROVIDERS.find((candidate) => candidate === value.toLowerCase());
  if (!provider) throw new ApiConfigError('KC_TRANSLATION_PROVIDER', `must be one of: ${TRANSLATION_PROVIDERS.join(', ')}`);
  if (provider === 'gemini' && !geminiApiKey) throw new ApiConfigError('GEMINI_API_KEY', 'is required when KC_TRANSLATION_PROVIDER is gemini');
  return provider;
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
  const geminiApiKey = readVariable(env, 'GEMINI_API_KEY') ?? null;
  const geminiModel = readVariable(env, 'GEMINI_MODEL') ?? DEFAULT_GEMINI_MODEL;
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
    rateLimitPerMinute: parseInteger(
      'KC_API_RATE_LIMIT_PER_MINUTE',
      readVariable(env, 'KC_API_RATE_LIMIT_PER_MINUTE'),
      DEFAULT_RATE_LIMIT_PER_MINUTE,
      0,
      100_000,
    ),
    translationProvider: parseTranslationProvider(readVariable(env, 'KC_TRANSLATION_PROVIDER'), geminiApiKey),
    gemini: { apiKey: geminiApiKey, model: geminiModel },
    postImport: {
      dailyBudget: parseInteger('KC_IMPORT_DAILY_BUDGET', readVariable(env, 'KC_IMPORT_DAILY_BUDGET'), DEFAULT_IMPORT_DAILY_BUDGET, 0, 1_000_000),
      model: readVariable(env, 'KC_IMPORT_MODEL') ?? geminiModel,
    },
    identityVerification: parseIdentityVerification(env),
    billing: parseBilling(env),
  };
}
