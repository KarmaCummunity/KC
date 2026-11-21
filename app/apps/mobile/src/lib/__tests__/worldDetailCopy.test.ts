// #2539: every world has its own detail title, close wording, closed pill and placeholder icon.
import { describe, expect, it } from 'vitest';
import { GIVING_WORLD_SLUGS, FEED_WORLD_SLUGS } from '@kc/domain';
import i18n from '../../i18n';
import {
  worldClosedStatusKey,
  worldDetailTitleKey,
  worldOwnerMarkCtaKey,
  worldPlaceholderIcon,
  worldReopenCtaKeys,
} from '../worldDetailCopy';

const ALL_WORLDS = [...new Set([...GIVING_WORLD_SLUGS, ...FEED_WORLD_SLUGS])];
const LANGUAGES = ['he', 'en'] as const;

/** Resolves a key in a language and fails when it is missing (i18next echoes the key back). */
function translate(lng: (typeof LANGUAGES)[number], key: string): string {
  const text = i18n.t(key, { lng });
  expect(text, `${lng}:${key}`).not.toBe(key);
  return text;
}

describe('worldDetailCopy (#2539)', () => {
  it.each(ALL_WORLDS)('%s has HE + EN title, close CTA, closed pill and an icon', (slug) => {
    for (const lng of LANGUAGES) {
      translate(lng, worldDetailTitleKey(slug));
      translate(lng, worldOwnerMarkCtaKey(slug, 'Give'));
      translate(lng, worldClosedStatusKey(slug));
    }
    expect(worldPlaceholderIcon(slug)).not.toBe('pricetag-outline');
  });

  it('words an employment post as a job, not a gift hand-over', () => {
    expect(worldDetailTitleKey('employment')).toBe('post.detail.worldTitle.employment');
    expect(translate('he', worldDetailTitleKey('employment'))).toBe('פרטי המשרה');
    expect(worldOwnerMarkCtaKey('employment', 'Give')).toBe('closure.markEmploymentCta');
    expect(worldOwnerMarkCtaKey('employment', 'Request')).toBe('closure.markEmploymentRequestCta');
    expect(worldPlaceholderIcon('employment')).toBe('briefcase-outline');
    expect(worldReopenCtaKeys('employment').label).toBe('closure.notCompletedCta');
  });

  it('keeps the existing copy of items, animals, housing, rides and time', () => {
    expect(worldOwnerMarkCtaKey('items')).toBe('closure.markGiveCta');
    expect(worldOwnerMarkCtaKey('animals')).toBe('closure.markAnimalsCta');
    expect(worldOwnerMarkCtaKey('housing')).toBe('closure.markHousingCta');
    expect(worldOwnerMarkCtaKey('rides')).toBe('closure.markRidesCta');
    expect(worldOwnerMarkCtaKey('time')).toBe('closure.markTimeCta');
    expect(worldDetailTitleKey('rides')).toBe('donations.rides.detailTitle');
    expect(worldReopenCtaKeys('items').label).toBe('closure.itemNotDeliveredCta');
  });

  it('falls back to generic copy for democracy, unknown worlds and plain posts', () => {
    expect(worldDetailTitleKey(null)).toBe('post.detailTitle');
    expect(worldDetailTitleKey('democracy')).toBe('post.detailTitle');
    expect(worldOwnerMarkCtaKey('democracy')).toBe('closure.markCompletedCta');
    expect(worldOwnerMarkCtaKey('brand-new-world')).toBe('closure.markCompletedCta');
    expect(worldClosedStatusKey('democracy')).toBe('post.detail.statusClosed');
    // A plain post is an item hand-over and keeps its legacy wording and direction icons.
    expect(worldOwnerMarkCtaKey(null, 'Give')).toBe('closure.markGiveCta');
    expect(worldOwnerMarkCtaKey(null, 'Request')).toBe('closure.markRequestCta');
    expect(worldPlaceholderIcon(null, 'Give')).toBe('gift-outline');
    expect(worldPlaceholderIcon(null, 'Request')).toBe('search-outline');
  });
});
