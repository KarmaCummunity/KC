import { describe, expect, it } from 'vitest';
import { MY_LISTINGS_PATH, resolveWorldChrome, worldFeedPath } from '../worldChromeRegistry';

describe('worldChromeRegistry', () => {
  it('resolves known worlds with feed path and my-listings in sub-screens', () => {
    const housing = resolveWorldChrome('housing');
    expect(housing?.feedPath).toBe('/(tabs)/donations/housing');
    expect(housing?.subScreens.some((s) => s.testID === 'world-hub-my-listings')).toBe(true);
    expect(worldFeedPath('time')).toBe('/(tabs)/donations/time');
  });

  it('MY_LISTINGS_PATH is stable for menu navigation', () => {
    expect(MY_LISTINGS_PATH).toBe('/(tabs)/donations/marketplace/my-listings');
  });

  it('returns null for unknown slug', () => {
    expect(resolveWorldChrome('money')).toBeNull();
  });
});
