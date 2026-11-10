import { describe, expect, it } from 'vitest';
import {
  mapMarketplaceServerError,
  validateKnowledgeSlot,
  validateMarketplaceWorldRules,
  validateRideDetails,
} from '../marketplaceWorldRules';

const now = new Date('2026-10-17T10:00:00Z');
const route = { origin_lat: 32.08, origin_lng: 34.78, dest_lat: 31.77, dest_lng: 35.21 };

describe('validateRideDetails', () => {
  it('requires both route ends', () => {
    expect(validateRideDetails({ departs_at: '2026-10-18T08:00:00Z' }, now)).toBe('ride_route_required');
    expect(
      validateRideDetails({ origin_lat: 32, origin_lng: 34, departs_at: '2026-10-18T08:00:00Z' }, now),
    ).toBe('ride_route_required');
    expect(validateRideDetails({ ...route, origin_lat: '32', departs_at: '2026-10-18T08:00:00Z' }, now)).toBe(
      'ride_route_required',
    );
  });
  it('requires a future departure', () => {
    expect(validateRideDetails({ ...route }, now)).toBe('ride_departure_past');
    expect(validateRideDetails({ ...route, departs_at: '2026-10-17T09:00:00Z' }, now)).toBe('ride_departure_past');
  });
  it('passes a complete future ride', () => {
    expect(validateRideDetails({ ...route, departs_at: '2026-10-17T12:00:00Z' }, now)).toBeNull();
  });
  it('is applied by validateMarketplaceWorldRules for rides', () => {
    expect(validateMarketplaceWorldRules({ worldSlug: 'rides', direction: 'give', details: {}, photoCount: 0, now })).toBe(
      'ride_route_required',
    );
    expect(
      validateMarketplaceWorldRules({
        worldSlug: 'rides',
        direction: 'give', details: { ...route, departs_at: '2026-10-17T12:00:00Z' }, photoCount: 0, now,
      }),
    ).toBeNull();
  });
});

describe('validateKnowledgeSlot', () => {
  it('ignores listings without slot fields (e.g. mentorship requests)', () => {
    expect(validateKnowledgeSlot({ topic: 'Math' }, now)).toBeNull();
  });
  it('rejects past starts and end before start', () => {
    expect(
      validateKnowledgeSlot({ slot_starts_at: '2026-10-17T09:00:00Z', slot_ends_at: '2026-10-17T11:00:00Z' }, now),
    ).toBe('knowledge_slot_invalid');
    expect(
      validateKnowledgeSlot({ slot_starts_at: '2026-10-17T12:00:00Z', slot_ends_at: '2026-10-17T11:00:00Z' }, now),
    ).toBe('knowledge_slot_invalid');
    expect(validateKnowledgeSlot({ slot_starts_at: '2026-10-17T12:00:00Z' }, now)).toBe('knowledge_slot_invalid');
  });
  it('passes a valid future slot via validateMarketplaceWorldRules', () => {
    expect(
      validateMarketplaceWorldRules({
        worldSlug: 'knowledge',
        direction: 'give',
        details: { slot_starts_at: '2026-10-17T12:00:00Z', slot_ends_at: '2026-10-17T13:00:00Z' },
        photoCount: 0,
        now,
      }),
    ).toBeNull();
  });
});

describe('booking error codes', () => {
  it('maps server booking errors', () => {
    expect(mapMarketplaceServerError({ code: 'P0001', message: 'seats_exhausted' })).toBe('seats_exhausted');
    expect(mapMarketplaceServerError({ code: '23514', message: 'ride_seats_exhausted' })).toBe('ride_seats_exhausted');
    expect(mapMarketplaceServerError({ message: 'slots_exhausted' })).toBe('slots_exhausted');
    expect(mapMarketplaceServerError({ code: '23505', message: 'already_booked' })).toBe('already_booked');
    expect(mapMarketplaceServerError({ message: 'ride_departed' })).toBe('ride_departed');
    expect(mapMarketplaceServerError({ message: 'session_not_started' })).toBe('session_not_started');
  });
});

// #2034 (0703–0704): a lesson offer or consulting hour lists its slots in `details.slots`.
describe('knowledge slot lists', () => {
  const slotAt = (start: string, end: string) => ({ starts_at: start, ends_at: end });

  it('validates details.slots with the server rules when the post has a slot list', () => {
    expect(validateKnowledgeSlot({ slots: [slotAt('2026-10-18T10:00:00Z', '2026-10-18T11:00:00Z')] }, now)).toBeNull();
    expect(
      validateKnowledgeSlot(
        { slots: [slotAt('2026-10-18T10:00:00Z', '2026-10-18T11:00:00Z'), slotAt('2026-10-18T10:30:00Z', '2026-10-18T11:30:00Z')] },
        now,
      ),
    ).toBe('knowledge_slots_overlap');
    expect(validateKnowledgeSlot({ slots: [] }, now)).toBe('knowledge_slot_invalid');
  });

  it('is applied by validateMarketplaceWorldRules for knowledge', () => {
    expect(
      validateMarketplaceWorldRules({
        worldSlug: 'knowledge',
        direction: 'give',
        details: { slots: [slotAt('2026-10-17T09:00:00Z', '2026-10-17T11:00:00Z')] },
        now,
      }),
    ).toBe('knowledge_slot_in_past');
  });

  it('maps the new knowledge server codes', () => {
    expect(mapMarketplaceServerError({ message: 'consulting_requires_id_verification' })).toBe(
      'consulting_requires_id_verification',
    );
    expect(mapMarketplaceServerError({ message: 'knowledge_slot_has_booking' })).toBe('knowledge_slot_has_booking');
    expect(mapMarketplaceServerError({ message: 'knowledge_slot_in_past' })).toBe('knowledge_slot_in_past');
  });
});
