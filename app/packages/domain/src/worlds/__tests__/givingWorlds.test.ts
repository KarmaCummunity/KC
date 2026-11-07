// D100 (docs/spec/04_product_structure.md): one list of 12 giving worlds, no domain layer.
import { describe, expect, it } from 'vitest';
import {
  FEED_WORLD_SLUGS,
  GIVING_WORLD_SLUGS,
  isFeedWorldSlug,
  isGivingWorldSlug,
  linkCategoryForWorld,
} from '../givingWorlds';
import { DONATION_CATEGORY_SLUGS } from '../../value-objects';

describe('giving worlds (spec 04, D100)', () => {
  it('lists the 12 giving worlds of the project book', () => {
    expect([...GIVING_WORLD_SLUGS].sort()).toEqual(
      ['animals', 'challenges', 'democracy', 'employment', 'food', 'housing', 'items', 'knowledge',
        'medical', 'money', 'rides', 'time'].sort(),
    );
  });

  it('keeps feed worlds a subset of the worlds', () => {
    for (const slug of FEED_WORLD_SLUGS) expect(isGivingWorldSlug(slug)).toBe(true);
    expect(isFeedWorldSlug('rides')).toBe(true);
    expect(isFeedWorldSlug('knowledge')).toBe(true);
    expect(isFeedWorldSlug('medical')).toBe(false);
  });

  it('rejects retired slugs: domains, experiences and app_design', () => {
    for (const retired of ['experiences', 'environment', 'elderly', 'sport', 'tech', 'app_design']) {
      expect(isGivingWorldSlug(retired)).toBe(false);
    }
  });

  it('maps every world except items to a links category that exists', () => {
    expect(linkCategoryForWorld('items')).toBeNull();
    expect(linkCategoryForWorld('rides')).toBe('transport');
    expect(linkCategoryForWorld('nope')).toBeNull();
    for (const world of GIVING_WORLD_SLUGS.filter((w) => w !== 'items')) {
      expect(DONATION_CATEGORY_SLUGS).toContain(linkCategoryForWorld(world));
    }
  });
});
