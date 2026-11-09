import { describe, expect, it } from 'vitest';
import { MY_LISTINGS_PATH, resolveWorldChrome, worldFeedPath } from '../worldChromeRegistry';

describe('worldChromeRegistry', () => {
  it('resolves known worlds with feed path and my-listings in sub-screens', () => {
    const housing = resolveWorldChrome('housing');
    expect(housing?.feedPath).toBe('/(tabs)/donations/housing');
    expect(housing?.subScreens.some((s) => s.testID === 'world-hub-my-listings')).toBe(true);
    expect(housing?.subScreens.some((s) => s.testID === 'world-hub-housing-links')).toBe(true);
    expect(worldFeedPath('time')).toBe('/(tabs)/donations/time');
  });

  it('configures dedicated links sub-screen for applicable marketplace giving worlds', () => {
    const worldsWithLinks = ['food', 'animals', 'housing', 'time', 'knowledge', 'rides'] as const;
    for (const slug of worldsWithLinks) {
      const config = resolveWorldChrome(slug);
      expect(config, `world ${slug} must be registered`).toBeTruthy();
      const link = config?.subScreens.find((s) => s.testID === `world-hub-${slug}-links`);
      expect(link, `world ${slug} must have dedicated links sub-screen`).toBeTruthy();
      expect(link?.path).toBe(`/(tabs)/donations/${slug}/links`);
      expect(link?.labelKey).toBe('donations.worldLinksNav');
    }
    // items has no links portal
    expect(resolveWorldChrome('items')?.subScreens.some((s) => s.testID === 'world-hub-items-links')).toBe(false);
  });

  it('MY_LISTINGS_PATH is stable for menu navigation', () => {
    expect(MY_LISTINGS_PATH).toBe('/(tabs)/donations/marketplace/my-listings');
  });

  it('returns null for unknown slug', () => {
    expect(resolveWorldChrome('money')).toBeNull();
  });
});
