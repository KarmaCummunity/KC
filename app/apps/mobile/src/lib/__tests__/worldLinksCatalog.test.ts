import { describe, expect, it } from 'vitest';
import type { DonationLink } from '@kc/domain';
import {
  filterAndSortInfoPosts,
  filterAndSortLinks,
  matchesWorldLinksQuery,
  visibleSections,
} from '../worldLinksCatalog';

function link(over: Partial<DonationLink>): DonationLink {
  return {
    id: 'l', categorySlug: 'animals', url: 'https://example.org', displayName: 'x', description: null,
    submittedBy: 'u', validatedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z',
    reviewStatus: 'approved', reviewNote: null, ...over,
  };
}

describe('matchesWorldLinksQuery', () => {
  it('matches everything for a query shorter than the minimum', () => {
    expect(matchesWorldLinksQuery('a', 'zzz')).toBe(true);
    expect(matchesWorldLinksQuery('   ', 'zzz')).toBe(true);
  });
  it('requires every word and ignores case', () => {
    expect(matchesWorldLinksQuery('DOG adoption', 'Adoption of a dog')).toBe(true);
    expect(matchesWorldLinksQuery('cat adoption', 'Adoption of a dog')).toBe(false);
  });
  it('folds Hebrew final letters so typing style does not matter', () => {
    expect(matchesWorldLinksQuery('\u05D3\u05E8\u05DB', '\u05D3\u05E8\u05DA')).toBe(true); // kaf typed vs final kaf stored
  });
  it('skips null fields', () => {
    expect(matchesWorldLinksQuery('abc', null, 'abc')).toBe(true);
  });
});

describe('filterAndSortLinks', () => {
  const a = link({ id: 'a', displayName: 'Beta', createdAt: '2026-01-02T00:00:00Z' });
  const b = link({ id: 'b', displayName: 'Alpha', createdAt: '2026-01-03T00:00:00Z', url: 'https://dogs.example.com/x' });
  const c = link({ id: 'c', displayName: 'Gamma', description: 'adopt a dog', createdAt: '2026-01-01T00:00:00Z' });

  it('sorts newest first, oldest first and alphabetically', () => {
    const ids = (sort: 'newest' | 'oldest' | 'alpha') => filterAndSortLinks([a, b, c], { query: '', sort }).map((l) => l.id);
    expect(ids('newest')).toEqual(['b', 'a', 'c']);
    expect(ids('oldest')).toEqual(['c', 'a', 'b']);
    expect(ids('alpha')).toEqual(['b', 'a', 'c']);
  });
  it('searches name, description and host', () => {
    expect(filterAndSortLinks([a, b, c], { query: 'dog', sort: 'newest' }).map((l) => l.id)).toEqual(['b', 'c']);
  });
  it('does not mutate the input', () => {
    const input = [a, b, c];
    filterAndSortLinks(input, { query: '', sort: 'alpha' });
    expect(input.map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('filterAndSortInfoPosts', () => {
  const posts = [
    { title: 'Zebra care', description: null, createdAt: '2026-02-01T00:00:00Z' },
    { title: 'Dog training', description: 'basics', createdAt: '2026-03-01T00:00:00Z' },
  ];
  it('filters by title/description and sorts', () => {
    expect(filterAndSortInfoPosts(posts, { query: 'basics', sort: 'newest' })).toHaveLength(1);
    expect(filterAndSortInfoPosts(posts, { query: '', sort: 'alpha' })[0].title).toBe('Dog training');
  });
});

describe('visibleSections', () => {
  it('maps the item-type filter to sections', () => {
    expect(visibleSections('all')).toEqual({ links: true, posts: true });
    expect(visibleSections('links')).toEqual({ links: true, posts: false });
    expect(visibleSections('posts')).toEqual({ links: false, posts: true });
  });
});
