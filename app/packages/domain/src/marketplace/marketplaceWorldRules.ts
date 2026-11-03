// Client-side mirror of the server world rules (0266 listings_enforce_world_rules) and a
// mapper from server error codes to stable codes the UI can translate.
// Items photos are optional (product decision; 0357 dropped the 0351 items image check).
// Keep in sync with supabase/migrations/0266, 0357.

export const ROUTED_WORLDS = ['medical', 'animals', 'environment'] as const;

export type MarketplaceRuleErrorCode =
  | 'food_expiry_required'
  | 'routed_world_requires_external_body'
  | 'ride_route_required'
  | 'ride_departure_past'
  | 'knowledge_slot_invalid';

/** Server-raised listing error codes the UI has friendly copy for. */
export const MARKETPLACE_SERVER_ERROR_CODES = [
  'food_expiry_required',
  'routed_world_requires_external_body',
  'ride_route_required',
  'ride_departure_past',
  'knowledge_slot_invalid',
  'seats_exhausted',
  'ride_seats_exhausted',
  'slots_exhausted',
  'already_booked',
  'ride_departed',
  'ride_not_started',
  'slot_started',
  'session_not_started',
  'own_listing',
  'listing_not_available',
  'item_already_reserved',
  'medical_listing_requires_external_body',
  'external_body_invalid',
  'world_permission_denied',
  'food_posting_banned',
  'ride_cost_share_cap_exceeded',
  'money_active_campaign_cap',
  'matchmaking_min_age',
  'details_schema_mismatch',
  'listing_details_schema_mismatch',
  'media_path_must_be_owned',
  'member_inactive',
  'auth_required',
  'kind_not_found',
  // D73 (0511) — ride booking management: wrong side, stale state or a vanished booking.
  'owner_only',
  'not_participant',
  'invalid_status',
  'handoff_not_found',
  // Items & food handoffs (0382, 0453, 0510).
  'invalid_pickup_mode',
  'handoff_not_confirmed',
  'invalid_rating',
  // D71 (0512) — ride places come only from official catalogs; at most 3 meeting points.
  'ride_place_invalid',
  'too_many_meeting_points',
  // D21 / D75 (0514) — the estimated end must follow the departure.
  'ride_arrival_before_departure',
  'ride_time_invalid',
  // D74 (0516) — saved routes: at most 10, and a route must go somewhere.
  'saved_routes_limit',
  'same_route',
  // D70 (0517) — the emergency button works only during the ride, once per 5 minutes.
  'ride_not_active',
  'emergency_throttled',
  // FR-RIDE-046 (0531) — recurring rides: the schedule, ownership and the terminal cancelled state.
  'ride_series_weekdays_invalid',
  'ride_series_duration_invalid',
  'ride_series_ends_in_past',
  'ride_series_no_occurrence',
  'ride_series_not_found',
  'ride_series_cancelled',
  'ride_series_status_invalid',
] as const;

export type MarketplaceServerErrorCode = (typeof MARKETPLACE_SERVER_ERROR_CODES)[number];

export interface WorldRulesInput {
  worldSlug: string;
  details: Record<string, unknown>;
  /** Number of attached photos. Informational only: photos are optional in every world. */
  photoCount: number;
  externalBodyId?: string | null;
  now?: Date;
}

function nonEmptyString(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

export function validateMarketplaceWorldRules(input: WorldRulesInput): MarketplaceRuleErrorCode | null {
  const { worldSlug, details } = input;

  if (worldSlug === 'food') {
    const raw = details.expires_at;
    const ts = typeof raw === 'string' ? Date.parse(raw) : Number.NaN;
    const now = (input.now ?? new Date()).getTime();
    if (Number.isNaN(ts) || ts <= now) return 'food_expiry_required';
  }

  if (worldSlug === 'rides') {
    const code = validateRideDetails(details, input.now);
    if (code) return code;
  }

  if (worldSlug === 'knowledge') {
    const code = validateKnowledgeSlot(details, input.now);
    if (code) return code;
  }

  if ((ROUTED_WORLDS as readonly string[]).includes(worldSlug) && !nonEmptyString(input.externalBodyId)) {
    return 'routed_world_requires_external_body';
  }

  return null;
}

function finiteNumber(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v);
}

function parseTime(v: unknown): number {
  return typeof v === 'string' ? Date.parse(v) : Number.NaN;
}

/** Native rides need both route ends (0391/0392 match on coordinates) and a future departure. */
export function validateRideDetails(
  details: Record<string, unknown>,
  now: Date = new Date(),
): MarketplaceRuleErrorCode | null {
  const coords = ['origin_lat', 'origin_lng', 'dest_lat', 'dest_lng'];
  if (!coords.every((k) => finiteNumber(details[k]))) return 'ride_route_required';
  const departs = parseTime(details.departs_at);
  if (Number.isNaN(departs) || departs <= now.getTime()) return 'ride_departure_past';
  return null;
}

/** Knowledge offers with a slot need a future start and an end after the start. */
export function validateKnowledgeSlot(
  details: Record<string, unknown>,
  now: Date = new Date(),
): MarketplaceRuleErrorCode | null {
  if (details.slot_starts_at === undefined && details.slot_ends_at === undefined) return null;
  const start = parseTime(details.slot_starts_at);
  const end = parseTime(details.slot_ends_at);
  if (Number.isNaN(start) || Number.isNaN(end) || start <= now.getTime() || end <= start) {
    return 'knowledge_slot_invalid';
  }
  return null;
}

/** Extracts a known listing error code from a PostgREST / Postgres error (or null). */
export function mapMarketplaceServerError(err: unknown): MarketplaceServerErrorCode | null {
  if (!err || typeof err !== 'object') {
    return typeof err === 'string' ? matchCode(err) : null;
  }
  const e = err as { message?: unknown; details?: unknown; hint?: unknown };
  for (const field of [e.message, e.details, e.hint]) {
    if (typeof field === 'string') {
      if (field.includes('giving_handoffs_active_listing_uidx')) {
        return 'listing_not_available';
      }
      const code = matchCode(field);
      if (code) return code;
    }
  }
  return null;
}

function matchCode(text: string): MarketplaceServerErrorCode | null {
  // Longest first so 'listing_details_schema_mismatch' wins over 'details_schema_mismatch'.
  const sorted = [...MARKETPLACE_SERVER_ERROR_CODES].sort((a, b) => b.length - a.length);
  return sorted.find((c) => new RegExp(`(^|[^a-z_])${c}([^a-z_]|$)`).test(text)) ?? null;
}
