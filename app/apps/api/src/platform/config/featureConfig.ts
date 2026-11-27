// The settings of the features that talk to an outside service (model, identity provider,
// billing providers, WhatsApp, translation). Each is optional at start: a feature without its
// settings refuses its own requests and the rest of the API works.

import { withoutTrailingSlashes } from '@kc/infrastructure-api';
import { ApiConfigError, type Env, parseInteger, readVariable } from './configReader';
import { parsePortRollout, type PortRolloutRules } from './portRolloutConfig';

export interface WhatsAppConfig {
  /** The Graph API token. A secret; null: nothing is sent. */
  readonly cloudApiToken: string | null;
  /** Overrides the phone number id stored with the channel's settings. */
  readonly phoneNumberId: string | null;
  /** Overrides the Graph API version stored with the channel's settings, e.g. `v21.0`. */
  readonly graphApiVersion: string | null;
  /** The token the provider echoes when the inbound webhook is registered. A secret; null: registration is refused. */
  readonly verifyToken: string | null;
  /** The app secret inbound deliveries are signed with. A secret; null: every delivery is refused. */
  readonly appSecret: string | null;
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

/** The Google Cloud Storage object store of a deployed API (ADR-012). */
export interface CloudStorageConfig {
  /** What precedes a KC bucket's name in its cloud bucket's name, e.g. `kc-dev-`. */
  readonly bucketPrefix: string;
  /** KC's media address, which serves the public buckets. */
  readonly mediaUrl: string;
}

export interface StorageConfig {
  /** Directory of the local-directory object store (development and tests); null: no store of that kind. */
  readonly localDirectory: string | null;
  /** The API's own address as clients reach it, which the local store's URLs point back at. */
  readonly publicUrl: string | null;
  /** The cloud object store; null: no store of that kind. Never together with `localDirectory`. */
  readonly cloud: CloudStorageConfig | null;
}

/** The feature settings, as `loadApiConfig` adds them to the configuration. */
export interface FeatureConfig {
  /** Where files are stored (ADR-012). */
  readonly storage: StorageConfig;
  /** Who each served port is served to; empty: everyone (`portRolloutConfig.ts`). */
  readonly portRollout: PortRolloutRules;
  /** The app's public web address, which a message to a member links to; null: the product's default. */
  readonly appBaseUrl: string | null;
  /** The WhatsApp channel through Meta's Cloud API. */
  readonly whatsapp: WhatsAppConfig;
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

const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';
const DEFAULT_IMPORT_DAILY_BUDGET = 2000;

/** One variable per payment provider: `PAYMENTS_WEBHOOK_SECRET_<PROVIDER SLUG IN UPPER CASE>`. */
const PAYMENT_SECRET_PREFIX = 'PAYMENTS_WEBHOOK_SECRET_';

function parseBilling(env: Env): BillingConfig {
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

function parseIdentityVerification(env: Env): IdentityVerificationConfig {
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

/** The app's public web address, without a trailing slash. */
function parseAppBaseUrl(env: Env): string | null {
  const raw = readVariable(env, 'KC_APP_BASE_URL');
  const url = raw === undefined ? null : withoutTrailingSlashes(raw);
  if (url !== null && !URL.canParse(url)) throw new ApiConfigError('KC_APP_BASE_URL', 'must be a URL');
  return url;
}

/** The local store needs both its directory and the address its URLs point at. */
function parseStorage(env: Env): StorageConfig {
  const localDirectory = readVariable(env, 'KC_STORAGE_LOCAL_DIR') ?? null;
  const rawPublicUrl = readVariable(env, 'KC_API_PUBLIC_URL');
  const publicUrl = rawPublicUrl === undefined ? null : withoutTrailingSlashes(rawPublicUrl);
  if (publicUrl !== null && !URL.canParse(publicUrl)) throw new ApiConfigError('KC_API_PUBLIC_URL', 'must be a URL');
  if (localDirectory !== null && publicUrl === null) throw new ApiConfigError('KC_API_PUBLIC_URL', 'is required when KC_STORAGE_LOCAL_DIR is set');
  const cloud = parseCloudStorage(env);
  // One process, one store: two would split the files between them.
  if (localDirectory !== null && cloud !== null) throw new ApiConfigError('KC_STORAGE_LOCAL_DIR', 'cannot be set together with KC_STORAGE_GCS_BUCKET_PREFIX');
  return { localDirectory, publicUrl, cloud };
}

/**
 * Lowercase letters, digits, dashes and underscores, as a cloud bucket name
 * allows. At most 50 characters: a bucket's whole name may have 63, and the
 * longest KC bucket name follows the prefix.
 */
const BUCKET_PREFIX = /^[a-z0-9][a-z0-9_-]{0,49}$/;

function parseCloudStorage(env: Env): CloudStorageConfig | null {
  const bucketPrefix = readVariable(env, 'KC_STORAGE_GCS_BUCKET_PREFIX');
  const rawMediaUrl = readVariable(env, 'KC_MEDIA_PUBLIC_URL');
  const mediaUrl = rawMediaUrl === undefined ? null : withoutTrailingSlashes(rawMediaUrl);
  if (mediaUrl !== null && !URL.canParse(mediaUrl)) throw new ApiConfigError('KC_MEDIA_PUBLIC_URL', 'must be a URL');
  if (bucketPrefix === undefined) return null;
  if (!BUCKET_PREFIX.test(bucketPrefix)) throw new ApiConfigError('KC_STORAGE_GCS_BUCKET_PREFIX', 'must be 1 to 50 lowercase letters, digits, dashes or underscores, starting with a letter or digit');
  if (mediaUrl === null) throw new ApiConfigError('KC_MEDIA_PUBLIC_URL', 'is required when KC_STORAGE_GCS_BUCKET_PREFIX is set');
  return { bucketPrefix, mediaUrl };
}

/** Reads every feature's settings. @throws ApiConfigError on the first invalid variable. */
export function loadFeatureConfig(env: Env): FeatureConfig {
  const geminiApiKey = readVariable(env, 'GEMINI_API_KEY') ?? null;
  const geminiModel = readVariable(env, 'GEMINI_MODEL') ?? DEFAULT_GEMINI_MODEL;
  return {
    storage: parseStorage(env),
    portRollout: parsePortRollout(env),
    appBaseUrl: parseAppBaseUrl(env),
    whatsapp: {
      cloudApiToken: readVariable(env, 'WHATSAPP_CLOUD_API_TOKEN') ?? null,
      phoneNumberId: readVariable(env, 'WHATSAPP_PHONE_NUMBER_ID') ?? null,
      graphApiVersion: readVariable(env, 'WHATSAPP_GRAPH_API_VERSION') ?? null,
      verifyToken: readVariable(env, 'WHATSAPP_VERIFY_TOKEN') ?? null,
      appSecret: readVariable(env, 'WHATSAPP_APP_SECRET') ?? null,
    },
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
