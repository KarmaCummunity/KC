import { describe, expect, it } from 'vitest';
import {
  analyticsCitySegment,
  isHubTileLaunchEnabled,
  isMarketplaceWorldLaunchEnabled,
  resolveLaunchWorldEnabled,
} from '../launchWorlds';

describe('launchWorlds', () => {
  it('defaults to items + food on, other worlds off', () => {
    expect(resolveLaunchWorldEnabled('world_items_enabled', undefined)).toBe(true);
    expect(resolveLaunchWorldEnabled('world_food_enabled', undefined)).toBe(true);
    expect(resolveLaunchWorldEnabled('world_rides_enabled', undefined)).toBe(false);
  });

  it('remote flag overrides compiled default', () => {
    expect(resolveLaunchWorldEnabled('world_rides_enabled', { world_rides_enabled: true })).toBe(true);
    expect(resolveLaunchWorldEnabled('world_food_enabled', { world_food_enabled: false })).toBe(false);
  });

  it('maps hub tiles and marketplace slugs', () => {
    expect(isHubTileLaunchEnabled('transport', undefined)).toBe(false);
    expect(isMarketplaceWorldLaunchEnabled('rides', { world_rides_enabled: true })).toBe(true);
  });

  it('segments Lod vs other for analytics', () => {
    expect(analyticsCitySegment('7000')).toBe('lod');
    expect(analyticsCitySegment('5000')).toBe('other');
    expect(analyticsCitySegment(null)).toBe('other');
  });
});

describe('launchWorldMode (D60)', () => {
  it('returns active when the flag is on and portal when it is off — never hidden', async () => {
    const { launchWorldMode, hubTileLaunchMode } = await import('../launchWorlds');
    expect(launchWorldMode('world_items_enabled', undefined)).toBe('active');
    expect(launchWorldMode('world_rides_enabled', undefined)).toBe('portal');
    expect(launchWorldMode('world_rides_enabled', { world_rides_enabled: true })).toBe('active');
    expect(hubTileLaunchMode('transport', { world_rides_enabled: false })).toBe('portal');
    expect(hubTileLaunchMode('unknown-tile', undefined)).toBe('active');
    // Phase 2/3 worlds are portals until their flag is turned on (D100).
    expect(hubTileLaunchMode('democracy', { world_items_enabled: true })).toBe('portal');
    expect(hubTileLaunchMode('democracy', { world_democracy_enabled: true })).toBe('active');
  });

  it('gives every portal world with a links list its category', async () => {
    const { PORTAL_CATEGORY_BY_FLAG } = await import('../launchWorlds');
    expect(PORTAL_CATEGORY_BY_FLAG.world_rides_enabled).toBe('transport');
    expect(PORTAL_CATEGORY_BY_FLAG.world_food_enabled).toBe('food');
    expect(PORTAL_CATEGORY_BY_FLAG.world_items_enabled).toBeUndefined();
  });
});

describe('challenges world launch default (PM 2026-11-04)', () => {
  it('is active without a remote flag and can still be switched off remotely', () => {
    expect(resolveLaunchWorldEnabled('world_challenges_enabled', undefined)).toBe(true);
    expect(resolveLaunchWorldEnabled('world_challenges_enabled', { world_challenges_enabled: false })).toBe(false);
  });
});
