// FR-FEED-020 AC2 / D-24 — every giving world must have a localized `marketplace.world.<slug>`
// label in he and en, so the world header and menu never fall back to the raw slug (#2538).
import { describe, expect, it } from 'vitest';
import { FEED_WORLD_SLUGS, GIVING_WORLD_SLUGS } from '@kc/domain';
import { marketplaceWorldLabels as he } from '../locales/he/donations.marketplaceExtras';
import { marketplaceWorldLabels as en } from '../locales/en/donations.marketplaceExtras';

const slugs = [...new Set<string>([...GIVING_WORLD_SLUGS, ...FEED_WORLD_SLUGS])];

describe.each([
  ['he', he],
  ['en', en],
])('marketplace.world labels (%s)', (_name, labels) => {
  const map = labels as Record<string, string>;
  it.each(slugs)('has a label for %s that is not the raw slug', (slug) => {
    expect(map[slug]).toBeTruthy();
    expect(map[slug]).not.toBe(slug);
  });
});
