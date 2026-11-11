import { describe, expect, it } from 'vitest';
import {
  MARKETPLACE_SERVER_ERROR_CODES,
  mapMarketplaceServerError,
  offerRequiresPhoto,
  validateMarketplaceWorldRules,
} from '../marketplaceWorldRules';

const now = new Date('2026-10-17T00:00:00Z');

describe('validateMarketplaceWorldRules — items', () => {
  it('requires a photo on an offer (D132, KC#1937)', () => {
    expect(validateMarketplaceWorldRules({ worldSlug: 'items', direction: 'give', details: {}, photoCount: 0 })).toBe(
      'offer_photo_required',
    );
    // A blank details image is not a photo.
    expect(validateMarketplaceWorldRules({ worldSlug: 'items', direction: 'give', details: { image_url: '  ' }, photoCount: 0 })).toBe(
      'offer_photo_required',
    );
  });
  it('passes with an attached photo or a details image', () => {
    expect(validateMarketplaceWorldRules({ worldSlug: 'items', direction: 'give', details: {}, photoCount: 1 })).toBeNull();
    expect(
      validateMarketplaceWorldRules({ worldSlug: 'items', direction: 'give', details: { image_url: 'https://x/y.jpg' }, photoCount: 0 }),
    ).toBeNull();
  });
});

describe('validateMarketplaceWorldRules — food', () => {
  it('requires a future expires_at', () => {
    expect(validateMarketplaceWorldRules({ worldSlug: 'food', direction: 'give', details: {}, photoCount: 0, now })).toBe(
      'food_expiry_required',
    );
    expect(
      validateMarketplaceWorldRules({ worldSlug: 'food', direction: 'give', details: { expires_at: 'nope' }, photoCount: 0, now }),
    ).toBe('food_expiry_required');
    expect(
      validateMarketplaceWorldRules({
        worldSlug: 'food',
        direction: 'give',
        details: { expires_at: '2026-10-16T00:00:00Z' },
        photoCount: 0,
        now,
      }),
    ).toBe('food_expiry_required');
  });
  it('passes with a future expiry', () => {
    expect(
      validateMarketplaceWorldRules({
        worldSlug: 'food',
        direction: 'give',
        details: { expires_at: '2026-10-18T12:00:00Z' },
        photoCount: 1,
        now,
      }),
    ).toBeNull();
  });
  // Regression: the request form has no expiry field, so requiring one blocked every food request.
  it('needs no expiry on a food request (D21)', () => {
    expect(
      validateMarketplaceWorldRules({ worldSlug: 'food', direction: 'request', details: {}, photoCount: 0, now }),
    ).toBeNull();
    expect(
      validateMarketplaceWorldRules({
        worldSlug: 'food',
        direction: 'request',
        details: { household_size: 3 },
        photoCount: 0,
        now,
      }),
    ).toBeNull();
  });
});

describe('validateMarketplaceWorldRules — routed worlds', () => {
  it.each(['medical', 'environment'])('%s requires an external body', (worldSlug) => {
    expect(validateMarketplaceWorldRules({ worldSlug, direction: 'give', details: {}, photoCount: 3 })).toBe(
      'routed_world_requires_external_body',
    );
    expect(validateMarketplaceWorldRules({ worldSlug, direction: 'give', details: {}, photoCount: 0, externalBodyId: 'org-1' })).toBeNull();
  });
  it('animals are direct give and take: no external body needed (0612)', () => {
    expect(validateMarketplaceWorldRules({ worldSlug: 'animals', direction: 'give', details: {}, photoCount: 1 })).toBeNull();
  });
  it('other worlds have no client rule', () => {
    expect(validateMarketplaceWorldRules({ worldSlug: 'knowledge', direction: 'give', details: {}, photoCount: 0 })).toBeNull();
  });
});

describe('validateMarketplaceWorldRules — time (organization events, 0563)', () => {
  const rules = (details: Record<string, unknown>) =>
    validateMarketplaceWorldRules({ worldSlug: 'time', direction: 'give', details, photoCount: 0, now });
  it('needs no window on a volunteer shift', () => {
    expect(rules({ duration_minutes: 60 })).toBeNull();
  });
  it('accepts an event that ends after it starts', () => {
    expect(rules({ starts_at: '2026-11-01T10:00:00Z', ends_at: '2026-11-01T12:00:00Z' })).toBeNull();
  });
  it('rejects an event that ends at or before its start, or misses an end', () => {
    expect(rules({ starts_at: '2026-11-01T10:00:00Z', ends_at: '2026-11-01T10:00:00Z' })).toBe('event_window_invalid');
    expect(rules({ starts_at: '2026-11-01T10:00:00Z', ends_at: '2026-11-01T09:00:00Z' })).toBe('event_window_invalid');
    expect(rules({ starts_at: '2026-11-01T10:00:00Z' })).toBe('event_window_invalid');
    expect(rules({ starts_at: 'nope', ends_at: '2026-11-01T12:00:00Z' })).toBe('event_window_invalid');
  });
});

describe('mapMarketplaceServerError', () => {
  it('maps PostgREST error messages to codes', () => {
    expect(mapMarketplaceServerError({ code: '23514', message: 'item_already_reserved' })).toBe('item_already_reserved');
    expect(mapMarketplaceServerError({ code: '23514', message: 'food_expiry_required' })).toBe('food_expiry_required');
    expect(mapMarketplaceServerError({ code: '23514', message: 'items_image_required' })).toBeNull();
    expect(mapMarketplaceServerError({ message: 'x', details: 'food_posting_banned' })).toBe('food_posting_banned');
    expect(mapMarketplaceServerError('ERROR: money_active_campaign_cap (SQLSTATE 23514)')).toBe(
      'money_active_campaign_cap',
    );
  });
  it('maps the one-live-handoff index of either handoff table to listing_not_available', () => {
    expect(
      mapMarketplaceServerError({
        code: '23505',
        message: 'duplicate key value violates unique constraint "giving_handoffs_active_listing_uidx"',
      }),
    ).toBe('listing_not_available');
    expect(
      mapMarketplaceServerError({
        code: '23505',
        message: 'duplicate key value violates unique constraint "post_handoffs_active_post_uidx"',
      }),
    ).toBe('listing_not_available');
  });
  it('prefers the longest matching code', () => {
    expect(mapMarketplaceServerError({ message: 'listing_details_schema_mismatch' })).toBe(
      'listing_details_schema_mismatch',
    );
    expect(mapMarketplaceServerError({ message: 'details_schema_mismatch' })).toBe('details_schema_mismatch');
  });
  it('returns null for unknown or empty errors', () => {
    expect(mapMarketplaceServerError(null)).toBeNull();
    expect(mapMarketplaceServerError(new Error('network down'))).toBeNull();
    expect(mapMarketplaceServerError({ message: 'not_food_expiry_required_x' })).toBeNull();
  });
  // G1 step 5 (0563): the event guard and the registration RPCs raise these codes.
  it('maps the organization event codes', () => {
    expect(mapMarketplaceServerError({ code: '42501', message: 'event_org_required' })).toBe('event_org_required');
    expect(mapMarketplaceServerError({ code: '23514', message: 'event_window_invalid' })).toBe('event_window_invalid');
    expect(mapMarketplaceServerError({ code: '42501', message: 'verification_required' })).toBe('verification_required');
    expect(mapMarketplaceServerError({ code: '42501', message: 'not_owner' })).toBe('not_owner');
    expect(mapMarketplaceServerError({ code: '23514', message: 'invalid_transition' })).toBe('invalid_transition');
    // 0564: the organizer marks attendance only after the event starts.
    expect(mapMarketplaceServerError({ code: '23514', message: 'event_not_started' })).toBe('event_not_started');
  });
  it('every code is unique', () => {
    expect(new Set(MARKETPLACE_SERVER_ERROR_CODES).size).toBe(MARKETPLACE_SERVER_ERROR_CODES.length);
  });
});

// D132 (KC#1937): an offer in items, food, housing or animals needs a photo.
describe('validateMarketplaceWorldRules — offer photo', () => {
  const future = { expires_at: '2026-10-18T12:00:00Z' };
  it.each(['items', 'food', 'housing', 'animals'])('a %s offer without a photo is refused', (worldSlug) => {
    expect(validateMarketplaceWorldRules({ worldSlug, direction: 'give', details: future, photoCount: 0, now })).toBe(
      'offer_photo_required',
    );
  });
  it.each(['items', 'food', 'housing', 'animals'])('a %s offer with one photo passes', (worldSlug) => {
    expect(validateMarketplaceWorldRules({ worldSlug, direction: 'give', details: future, photoCount: 1, now })).toBeNull();
  });
  it.each(['items', 'food', 'housing', 'animals'])('a %s request never needs a photo', (worldSlug) => {
    expect(validateMarketplaceWorldRules({ worldSlug, direction: 'request', details: {}, photoCount: 0, now })).toBeNull();
  });
  it('a ride offer keeps photos optional', () => {
    expect(offerRequiresPhoto('rides', 'give')).toBe(false);
  });
  it('a listing edit (photo count unknown) skips the rule', () => {
    expect(validateMarketplaceWorldRules({ worldSlug: 'housing', direction: 'give', details: {}, now })).toBeNull();
  });
  it('reports a field-specific problem before the missing photo', () => {
    expect(validateMarketplaceWorldRules({ worldSlug: 'food', direction: 'give', details: {}, photoCount: 0, now })).toBe(
      'food_expiry_required',
    );
  });
  it('maps the server code to itself', () => {
    expect(mapMarketplaceServerError({ message: 'offer_photo_required' })).toBe('offer_photo_required');
  });
});

// D137 (KC#1398): a food offer's type is its world sub-category.
describe('validateMarketplaceWorldRules — food sub-category', () => {
  const future = { expires_at: '2026-10-18T12:00:00Z' };
  it('refuses a food offer with no sub-category', () => {
    expect(
      validateMarketplaceWorldRules({ worldSlug: 'food', direction: 'give', details: future, photoCount: 1, subcategoryId: null, now }),
    ).toBe('food_subcategory_required');
  });
  it('passes a food offer with a sub-category', () => {
    expect(
      validateMarketplaceWorldRules({ worldSlug: 'food', direction: 'give', details: future, photoCount: 1, subcategoryId: 'cat-1', now }),
    ).toBeNull();
  });
  it('never asks a food request or another world for a sub-category', () => {
    expect(validateMarketplaceWorldRules({ worldSlug: 'food', direction: 'request', details: {}, subcategoryId: null, now })).toBeNull();
    expect(validateMarketplaceWorldRules({ worldSlug: 'items', direction: 'give', details: {}, photoCount: 1, subcategoryId: null, now })).toBeNull();
  });
  it('skips the rule when the caller passes no sub-category (a listing edit)', () => {
    expect(validateMarketplaceWorldRules({ worldSlug: 'food', direction: 'give', details: future, photoCount: 1, now })).toBeNull();
  });
  it('reports the missing expiry before the missing sub-category', () => {
    expect(
      validateMarketplaceWorldRules({ worldSlug: 'food', direction: 'give', details: {}, photoCount: 1, subcategoryId: null, now }),
    ).toBe('food_expiry_required');
  });
});
