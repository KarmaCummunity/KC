// Client-side mirror of the server world rules (0266 listings_enforce_world_rules) and a
// mapper from server error codes to stable codes the UI can translate.
// An offer in a photo world needs at least one photo (D132, KC#1937; it
// reverses the items-only removal of 0357). Server parity: KC#2020.
// Keep in sync with supabase/migrations/0266, 0357, 0539 (food expiry binds offers only),
// 0563 (an organization's event ends after it starts) and 0612 (animals are no longer routed).

// Animals left this list in 0612: members give and take directly there (PM 2026-11-04).
export const ROUTED_WORLDS = ['medical', 'environment'] as const;

/**
 * Worlds whose offers (`give`) must carry at least one photo (D132).
 * Requests stay photo-optional everywhere, and so do rides (a ride is not a thing to look at).
 */
export const OFFER_PHOTO_WORLDS = ['items', 'food', 'housing', 'animals'] as const;

/** True when publishing this side of this world needs at least one photo. */
export function offerRequiresPhoto(worldSlug: string, direction: 'give' | 'request'): boolean {
  return direction === 'give' && (OFFER_PHOTO_WORLDS as readonly string[]).includes(worldSlug);
}

export type MarketplaceRuleErrorCode =
  | 'offer_photo_required'
  | 'food_subcategory_required'
  | 'food_expiry_required'
  | 'routed_world_requires_external_body'
  | 'ride_route_required'
  | 'ride_departure_past'
  | 'knowledge_slot_invalid'
  | 'event_window_invalid';

/** Server-raised listing error codes the UI has friendly copy for. */
export const MARKETPLACE_SERVER_ERROR_CODES = [
  'offer_photo_required',
  'food_subcategory_required',
  'food_expiry_required',
  'routed_world_requires_external_body',
  'ride_route_required',
  'ride_departure_past',
  'knowledge_slot_invalid',
  'event_window_invalid',
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
  // Housing stays (0600–0603, spec 21_housing.md): conduct, dates, capacity, privacy, lifecycle.
  'housing_conduct_required',
  'housing_conduct_version_stale',
  'housing_nights_out_of_range',
  'housing_dates_invalid',
  'housing_dates_unavailable',
  'housing_details_invalid',
  'housing_tent_facilities_required',
  'housing_capacity_exceeded',
  'housing_policy_mismatch',
  'housing_minor_unaccompanied',
  'housing_message_required',
  'housing_pending_cap',
  'housing_booking_overlap',
  'housing_private_details_hidden',
  'housing_city_required',
  'housing_booking_started',
  'housing_cancel_reason_required',
  'housing_not_in_window',
  'housing_note_too_long',
  'housing_use_booking_cancel',
  // G1 step 5 (0563) — organization events: membership, verified-only registration, organizer actions.
  'event_org_required',
  'verification_required',
  'not_owner',
  'invalid_transition',
  // G1 step 5c (0564) — attendance is marked only once the event has started.
  'event_not_started',
] as const;

export type MarketplaceServerErrorCode = (typeof MARKETPLACE_SERVER_ERROR_CODES)[number];

export interface WorldRulesInput {
  worldSlug: string;
  /** Offer (`give`) or request: some rules bind one side only (food expiry, D21 / D28). */
  direction: 'give' | 'request';
  details: Record<string, unknown>;
  /**
   * Number of attached photos. Undefined when the form does not manage photos (a listing edit
   * keeps its photos as they are), so the photo rule is skipped there.
   */
  photoCount?: number;
  /**
   * The chosen world sub-category, or null when none is chosen. Undefined when the form does not
   * manage it (a listing edit keeps its sub-category), so the sub-category rule is skipped there.
   */
  subcategoryId?: string | null;
  externalBodyId?: string | null;
  now?: Date;
}

function nonEmptyString(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

export function validateMarketplaceWorldRules(input: WorldRulesInput): MarketplaceRuleErrorCode | null {
  const { worldSlug, details } = input;

  // A food offer carries the giver's future expiry (D28); a food request has none (D21).
  if (worldSlug === 'food' && input.direction === 'give') {
    const raw = details.expires_at;
    const ts = typeof raw === 'string' ? Date.parse(raw) : Number.NaN;
    const now = (input.now ?? new Date()).getTime();
    if (Number.isNaN(ts) || ts <= now) return 'food_expiry_required';
    // A food offer's type is its world sub-category (D137, KC#1398).
    if (input.subcategoryId === null) return 'food_subcategory_required';
  }

  if (worldSlug === 'rides') {
    const code = validateRideDetails(details, input.now);
    if (code) return code;
  }

  if (worldSlug === 'knowledge') {
    const code = validateKnowledgeSlot(details, input.now);
    if (code) return code;
  }

  // Only an organization's event carries a window in the time world (0563).
  if (worldSlug === 'time') {
    const code = validateEventWindow(details);
    if (code) return code;
  }

  if ((ROUTED_WORLDS as readonly string[]).includes(worldSlug) && !nonEmptyString(input.externalBodyId)) {
    return 'routed_world_requires_external_body';
  }

  // Checked last, so a form with several problems still reports the field-specific ones first.
  if (lacksRequiredPhoto(input)) return 'offer_photo_required';

  return null;
}

/** An offer in a photo world with neither an attached photo nor a legacy details image (0351). */
function lacksRequiredPhoto(input: WorldRulesInput): boolean {
  if (input.photoCount === undefined || !offerRequiresPhoto(input.worldSlug, input.direction)) return false;
  return input.photoCount === 0 && !nonEmptyString(input.details.image_url);
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

/** An event with a window needs both ends, and its end after its start (0563 listings_event_guard). */
export function validateEventWindow(details: Record<string, unknown>): MarketplaceRuleErrorCode | null {
  if (details.starts_at === undefined && details.ends_at === undefined) return null;
  const start = parseTime(details.starts_at);
  const end = parseTime(details.ends_at);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 'event_window_invalid';
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
      // One live handoff per item / food offer: the legacy index and the post record's (0555).
      if (
        field.includes('giving_handoffs_active_listing_uidx') ||
        field.includes('post_handoffs_active_post_uidx')
      ) {
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
