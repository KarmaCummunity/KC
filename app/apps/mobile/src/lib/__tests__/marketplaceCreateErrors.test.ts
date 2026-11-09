import { describe, expect, it } from 'vitest';
import { handoffErrorKey, marketplaceRuleFieldError, marketplaceServerErrorKey } from '../marketplaceCreateErrors';

describe('marketplaceServerErrorKey', () => {
  it('maps known server codes to marketplace.errors.<code>', () => {
    expect(marketplaceServerErrorKey({ code: '23514', message: 'money_active_campaign_cap' })).toBe(
      'marketplace.errors.money_active_campaign_cap',
    );
    expect(marketplaceServerErrorKey({ message: 'food_expiry_required' })).toBe(
      'marketplace.errors.food_expiry_required',
    );
  });
  it('falls back to generic for unknown errors', () => {
    expect(marketplaceServerErrorKey(new Error('fetch failed'))).toBe('marketplace.errors.generic');
    expect(marketplaceServerErrorKey(undefined)).toBe('marketplace.errors.generic');
  });
});

describe('marketplaceRuleFieldError', () => {
  it('an items offer without photos → inline photo error (D132, KC#1937)', () => {
    expect(marketplaceRuleFieldError({ worldSlug: 'items', direction: 'give', details: {}, photoCount: 0 })).toEqual({
      code: 'offer_photo_required',
      field: 'photos',
      key: 'marketplace.errors.offer_photo_required',
    });
    expect(marketplaceRuleFieldError({ worldSlug: 'items', direction: 'give', details: {}, photoCount: 2 })).toBeNull();
  });
  it('a listing edit passes no photo count → no photo error', () => {
    expect(marketplaceRuleFieldError({ worldSlug: 'animals', direction: 'give', details: {} })).toBeNull();
  });
  it('food offer without expiry → inline details error', () => {
    expect(marketplaceRuleFieldError({ worldSlug: 'food', direction: 'give', details: {}, photoCount: 0 })?.field).toBe('details');
  });
  it('a food offer with no sub-category → inline sub-category error ({{D:food-type-is-subcategory}}, KC#1398)', () => {
    const details = { expires_at: '2099-01-01T10:00:00Z' };
    expect(marketplaceRuleFieldError({ worldSlug: 'food', direction: 'give', details, photoCount: 1, subcategoryId: null })).toEqual({
      code: 'food_subcategory_required',
      field: 'subcategory',
      key: 'marketplace.errors.food_subcategory_required',
    });
  });
  it('food request without expiry → no error (requests never expire, D21)', () => {
    expect(marketplaceRuleFieldError({ worldSlug: 'food', direction: 'request', details: {}, photoCount: 0 })).toBeNull();
  });
  it('routed worlds → inline organisation-picker error', () => {
    expect(marketplaceRuleFieldError({ worldSlug: 'medical', direction: 'give', details: {}, photoCount: 0 })?.field).toBe('org');
  });
});

// G1 step 5 (0563): an organization's event must end after it starts, checked before publishing.
describe('marketplaceRuleFieldError — organization events', () => {
  it('an event that ends before it starts → localized inline details error', () => {
    const details = { starts_at: '2030-01-01T12:00:00Z', ends_at: '2030-01-01T10:00:00Z' };
    expect(marketplaceRuleFieldError({ worldSlug: 'time', direction: 'give', details, photoCount: 0 })).toEqual({
      code: 'event_window_invalid',
      field: 'details',
      key: 'marketplace.errors.event_window_invalid',
    });
  });
  it('a volunteer shift has no window to check', () => {
    expect(marketplaceRuleFieldError({ worldSlug: 'time', direction: 'give', details: { duration_minutes: 60 }, photoCount: 0 })).toBeNull();
  });
});

describe('handoffErrorKey', () => {
  it('maps booking RPC errors to marketplace.errors keys', () => {
    expect(handoffErrorKey({ message: 'seats_exhausted' })).toBe('marketplace.errors.seats_exhausted');
    expect(handoffErrorKey({ message: 'own_listing' })).toBe('marketplace.errors.own_listing');
    expect(handoffErrorKey({ message: 'verification_required' })).toBe('marketplace.errors.verification_required');
  });
  it('returns null for unknown errors so callers use the generic copy', () => {
    expect(handoffErrorKey(new Error('network'))).toBeNull();
  });
});

describe('marketplaceRuleFieldError — rides / knowledge', () => {
  it('missing ride route → inline details error', () => {
    expect(marketplaceRuleFieldError({ worldSlug: 'rides', direction: 'give', details: {}, photoCount: 0 })).toEqual({
      code: 'ride_route_required',
      field: 'details',
      key: 'marketplace.errors.ride_route_required',
    });
  });
  it('bad knowledge slot → inline details error', () => {
    expect(
      marketplaceRuleFieldError({
        worldSlug: 'knowledge',
        direction: 'give',
        details: { slot_starts_at: '2000-01-01T00:00:00Z', slot_ends_at: '2000-01-01T01:00:00Z' },
        photoCount: 0,
      })?.code,
    ).toBe('knowledge_slot_invalid');
  });
});
