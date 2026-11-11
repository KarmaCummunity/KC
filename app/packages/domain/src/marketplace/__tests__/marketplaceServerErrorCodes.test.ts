// Baseline reasons raised by the posts, handoffs and worlds RPCs the marketplace screens call
// (supabase/schemas/20_posts, 25_handoffs, 70_worlds) map to their own code, so the UI shows
// precise copy instead of the generic message.
import { describe, expect, it } from 'vitest';
import { BackendRuleError } from '../../errors';
import { MARKETPLACE_SERVER_ERROR_CODES, mapMarketplaceServerError } from '../marketplaceWorldRules';

const BASELINE_REASONS = [
  'declaration_required',
  'ride_seats_below_bookings',
  'not_ride_offer',
  'ride_series_schedule_invalid',
  'event_time_invalid',
  'event_capacity_below_registrations',
  'event_message_invalid',
  'food_expiry_in_past',
  'knowledge_slots_limit',
  'housing_active_booking_conflict',
  'handoff_already_rated',
  'handoff_world_not_supported',
  'emergency_not_active',
  'post_details_mismatch',
  'post_details_not_supported',
  'post_details_required',
  'post_kind_not_allowed',
  'post_limit_exceeded',
  'post_not_found',
  'consent_version_stale',
  'rate_limited',
  'unauthenticated',
] as const;

describe('baseline marketplace reasons', () => {
  it.each(BASELINE_REASONS)('%s is a known code', (reason) => {
    expect(MARKETPLACE_SERVER_ERROR_CODES as readonly string[]).toContain(reason);
  });

  it.each(BASELINE_REASONS)('%s maps from a BackendRuleError', (reason) => {
    expect(mapMarketplaceServerError(new BackendRuleError(reason, 'rpc:test'))).toBe(reason);
  });

  it('maps a raw PostgREST error carrying the reason', () => {
    expect(mapMarketplaceServerError({ code: 'P0001', message: 'declaration_required' })).toBe('declaration_required');
  });

  it('prefers the longer code when one contains another', () => {
    expect(mapMarketplaceServerError({ message: 'ride_seats_exhausted' })).toBe('ride_seats_exhausted');
    expect(mapMarketplaceServerError({ message: 'seats_exhausted' })).toBe('seats_exhausted');
  });
});
