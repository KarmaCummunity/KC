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
  it('items without photos → no error (photos are optional)', () => {
    expect(marketplaceRuleFieldError({ worldSlug: 'items', direction: 'give', details: {}, photoCount: 0 })).toBeNull();
    expect(marketplaceRuleFieldError({ worldSlug: 'items', direction: 'give', details: {}, photoCount: 2 })).toBeNull();
  });
  it('food offer without expiry → inline details error', () => {
    expect(marketplaceRuleFieldError({ worldSlug: 'food', direction: 'give', details: {}, photoCount: 0 })?.field).toBe('details');
  });
  it('food request without expiry → no error (requests never expire, D21)', () => {
    expect(marketplaceRuleFieldError({ worldSlug: 'food', direction: 'request', details: {}, photoCount: 0 })).toBeNull();
  });
  it('routed worlds → inline organisation-picker error', () => {
    expect(marketplaceRuleFieldError({ worldSlug: 'medical', direction: 'give', details: {}, photoCount: 0 })?.field).toBe('org');
  });
});

describe('handoffErrorKey', () => {
  it('maps booking RPC errors to marketplace.errors keys', () => {
    expect(handoffErrorKey({ message: 'seats_exhausted' })).toBe('marketplace.errors.seats_exhausted');
    expect(handoffErrorKey({ message: 'own_listing' })).toBe('marketplace.errors.own_listing');
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
