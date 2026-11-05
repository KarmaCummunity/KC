// Maps marketplace create-listing rule codes and server errors to i18n keys
// under `marketplace.errors.*` (locales/*/donations.marketplaceErrors.ts).
import {
  mapMarketplaceServerError,
  validateMarketplaceWorldRules,
  type MarketplaceRuleErrorCode,
  type WorldRulesInput,
} from '@kc/domain';

export type MarketplaceErrorKey = `marketplace.errors.${string}`;

/** i18n key for a thrown create-listing error; falls back to `marketplace.errors.generic`. */
export function marketplaceServerErrorKey(err: unknown): MarketplaceErrorKey {
  const code = mapMarketplaceServerError(err);
  return `marketplace.errors.${code ?? 'generic'}`;
}

export interface MarketplaceRuleFieldError {
  code: MarketplaceRuleErrorCode;
  /** Which form section renders the inline message. */
  field: 'details' | 'org';
  key: MarketplaceErrorKey;
}

const FIELD_BY_CODE: Record<MarketplaceRuleErrorCode, MarketplaceRuleFieldError['field']> = {
  food_expiry_required: 'details',
  routed_world_requires_external_body: 'org',
  ride_route_required: 'details',
  ride_departure_past: 'details',
  knowledge_slot_invalid: 'details',
  event_window_invalid: 'details',
};

/** i18n key for a booking / handoff RPC error; null when there is no specific copy. */
export function handoffErrorKey(err: unknown): MarketplaceErrorKey | null {
  const code = mapMarketplaceServerError(err);
  return code ? `marketplace.errors.${code}` : null;
}

/** Client-side world-rule check for the create form (mirrors 0266; photos are optional). */
export function marketplaceRuleFieldError(input: WorldRulesInput): MarketplaceRuleFieldError | null {
  const code = validateMarketplaceWorldRules(input);
  if (!code) return null;
  return { code, field: FIELD_BY_CODE[code], key: `marketplace.errors.${code}` };
}
