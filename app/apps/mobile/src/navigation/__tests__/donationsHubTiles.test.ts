// D60 / D3 (docs/spec/04_product_structure.md): every world is shown in full.
// A launch flag decides whether a world is "active" (full in-app flow) or a
// "portal" (links + knowledge) — it never removes the world from the hub (G37).
import { describe, expect, it } from 'vitest';
import { GIVING_WORLD_SLUGS, LAUNCH_WORLD_FLAG_DEFAULTS } from '@kc/domain';
import { DONATIONS_HUB_TILES, donationsHubTiles } from '../donationsHubTiles';

const ALL_OFF = Object.fromEntries(Object.keys(LAUNCH_WORLD_FLAG_DEFAULTS).map((k) => [k, false]));

describe('donationsHubTiles', () => {
  it('lists exactly the 12 giving worlds in one list — no domains, no experiences (D100)', () => {
    const worldOf = (key: string) => (key === 'transport' ? 'rides' : key);
    expect(DONATIONS_HUB_TILES.map((t) => worldOf(t.key))).toEqual([...GIVING_WORLD_SLUGS]);
  });

  it('opens a world without its own screen on the generic links screen', () => {
    const href = (key: string) => DONATIONS_HUB_TILES.find((t) => t.key === key)?.href;
    expect(href('items')).toBe('/(tabs)/donations/items');
    expect(href('medical')).toBe('/(tabs)/donations/category/medical');
    expect(href('democracy')).toBe('/(tabs)/donations/category/democracy');
  });

  it('opens the challenges world on its own screen', () => {
    expect(DONATIONS_HUB_TILES.find((t) => t.key === 'challenges')?.href).toBe('/(tabs)/donations/challenges');
  });

  it('shows every world tile with the default launch flags', () => {
    expect(donationsHubTiles(undefined).map((t) => t.tile.key)).toEqual(DONATIONS_HUB_TILES.map((t) => t.key));
  });

  it('marks worlds whose flag is off as portals instead of hiding them', () => {
    const tiles = donationsHubTiles(ALL_OFF);
    expect(tiles).toHaveLength(DONATIONS_HUB_TILES.length);
    expect(new Set(tiles.map((t) => t.mode))).toEqual(new Set(['portal']));
  });

  it('marks worlds whose flag is on as active', () => {
    const tiles = donationsHubTiles({ world_food_enabled: true, world_rides_enabled: false });
    expect(tiles.find((t) => t.tile.key === 'food')?.mode).toBe('active');
    expect(tiles.find((t) => t.tile.key === 'transport')?.mode).toBe('portal');
  });

  it('opens each giving world of the create form on its own world screen (FR-FEED-020 AC2)', () => {
    const href = (key: string) => DONATIONS_HUB_TILES.find((t) => t.key === key)?.href;
    expect(href('food')).toBe('/(tabs)/donations/food');
    expect(href('housing')).toBe('/(tabs)/donations/housing');
    expect(href('time')).toBe('/(tabs)/donations/time');
    expect(href('transport')).toBe('/(tabs)/donations/rides');
  });
});
