import { describe, expect, it } from 'vitest';
import {
  MARKETPLACE_SERVER_ERROR_CODES,
  mapMarketplaceServerError,
  validateMarketplaceWorldRules,
} from '../marketplaceWorldRules';

const now = new Date('2026-10-17T00:00:00Z');

describe('validateMarketplaceWorldRules — items', () => {
  it('does not require a photo (photos are optional)', () => {
    expect(validateMarketplaceWorldRules({ worldSlug: 'items', details: {}, photoCount: 0 })).toBeNull();
    expect(validateMarketplaceWorldRules({ worldSlug: 'items', details: { image_url: '  ' }, photoCount: 0 })).toBeNull();
  });
  it('passes with an attached photo or a details image', () => {
    expect(validateMarketplaceWorldRules({ worldSlug: 'items', details: {}, photoCount: 1 })).toBeNull();
    expect(
      validateMarketplaceWorldRules({ worldSlug: 'items', details: { image_url: 'https://x/y.jpg' }, photoCount: 0 }),
    ).toBeNull();
  });
});

describe('validateMarketplaceWorldRules — food', () => {
  it('requires a future expires_at', () => {
    expect(validateMarketplaceWorldRules({ worldSlug: 'food', details: {}, photoCount: 0, now })).toBe(
      'food_expiry_required',
    );
    expect(
      validateMarketplaceWorldRules({ worldSlug: 'food', details: { expires_at: 'nope' }, photoCount: 0, now }),
    ).toBe('food_expiry_required');
    expect(
      validateMarketplaceWorldRules({
        worldSlug: 'food',
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
        details: { expires_at: '2026-10-18T12:00:00Z' },
        photoCount: 0,
        now,
      }),
    ).toBeNull();
  });
});

describe('validateMarketplaceWorldRules — routed worlds', () => {
  it.each(['medical', 'animals', 'environment'])('%s requires an external body', (worldSlug) => {
    expect(validateMarketplaceWorldRules({ worldSlug, details: {}, photoCount: 3 })).toBe(
      'routed_world_requires_external_body',
    );
    expect(validateMarketplaceWorldRules({ worldSlug, details: {}, photoCount: 0, externalBodyId: 'org-1' })).toBeNull();
  });
  it('other worlds have no client rule', () => {
    expect(validateMarketplaceWorldRules({ worldSlug: 'knowledge', details: {}, photoCount: 0 })).toBeNull();
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
  it('every code is unique', () => {
    expect(new Set(MARKETPLACE_SERVER_ERROR_CODES).size).toBe(MARKETPLACE_SERVER_ERROR_CODES.length);
  });
});
