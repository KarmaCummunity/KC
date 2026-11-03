import { describe, expect, it } from 'vitest';
import {
  analyticsCitySegment,
  isHubTileLaunchEnabled,
  isMarketplaceWorldLaunchEnabled,
  launchWorldFlagKeyForSlug,
} from '../launchWorlds';

describe('launchWorlds branches', () => {
  it('unknown keys default to enabled', () => {
    expect(launchWorldFlagKeyForSlug('nope')).toBeNull();
    expect(isMarketplaceWorldLaunchEnabled('nope', undefined)).toBe(true);
    expect(isHubTileLaunchEnabled('nope', undefined)).toBe(true);
  });
  it('remote overrides defaults', () => {
    expect(isMarketplaceWorldLaunchEnabled('rides', { world_rides_enabled: true })).toBe(true);
    expect(isHubTileLaunchEnabled('items', { world_items_enabled: false })).toBe(false);
  });
  it('segments city', () => {
    expect(analyticsCitySegment('7000')).toBe('lod');
    expect(analyticsCitySegment(null)).toBe('other');
  });
});
