import { describe, expect, it } from 'vitest';
import {
  emptyWorldContent,
  isWorldContentEmpty,
  localizedWorldLabel,
  worldLinkListSlug,
  worldSlugOfLinkList,
  type WorldLink,
} from '../worldContent';

const LINK: WorldLink = {
  linkId: 'l1', fromWorldSlug: 'animals', toWorldSlug: 'food', linkSlug: 'pet_food',
  labelHe: 'מזון לחיות', labelEn: 'Pet food', description: null,
};

describe('world content', () => {
  it('is empty until a link, an organization or a topic exists', () => {
    const empty = emptyWorldContent('animals');
    expect(empty).toEqual({ worldSlug: 'animals', links: [], externalBodies: [], topics: [] });
    expect(isWorldContentEmpty(empty)).toBe(true);
    expect(isWorldContentEmpty({ ...empty, links: [LINK] })).toBe(false);
  });

  it('labels a row in the language of the interface and falls back when one label is blank', () => {
    expect(localizedWorldLabel(LINK, 'he')).toBe('מזון לחיות');
    expect(localizedWorldLabel(LINK, 'en-US')).toBe('Pet food');
    expect(localizedWorldLabel({ labelHe: ' ', labelEn: 'Pet food' }, 'he')).toBe('Pet food');
  });

  it('names the community link list of a world; rides keeps the older list name, items has none', () => {
    expect(worldLinkListSlug('medical')).toBe('medical');
    expect(worldLinkListSlug('rides')).toBe('transport');
    expect(worldLinkListSlug('items')).toBeNull();
    expect(worldLinkListSlug('unknown')).toBeNull();
    expect(worldSlugOfLinkList('transport')).toBe('rides');
    expect(worldSlugOfLinkList('medical')).toBe('medical');
  });
});
