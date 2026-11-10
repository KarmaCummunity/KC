import { describe, it, expect } from 'vitest';
import {
  mapLinkSearchResult,
  mapUserSearchResult,
  type LinkRow,
  type SearchUserRow,
} from '../searchMappers';

function makeUserRow(overrides: Partial<SearchUserRow> = {}): SearchUserRow {
  return {
    user_id: 'u_1',
    display_name: 'Alice',
    share_handle: 'alice',
    avatar_url: 'https://cdn.example.com/u_1.jpg',
    biography: 'Loves books.',
    city: 'IL-001',
    city_name: 'Tel Aviv',
    followers_count: 10,
    items_given_count: 4,
    verification_level: 1,
    ...overrides,
  };
}

function makeLinkRow(overrides: Partial<LinkRow> = {}): LinkRow {
  return {
    id: 'l_1',
    category_slug: 'food',
    url: 'https://example.org/donate',
    display_name: 'Food bank',
    description: 'Supports families in need.',
    tags: 'tag1, tag2',
    ...overrides,
  } as unknown as LinkRow;
}

describe('mapUserSearchResult', () => {
  it('maps every column to its UserSearchResult field on the happy path', () => {
    const out = mapUserSearchResult(makeUserRow());

    expect(out).toEqual({
      userId: 'u_1',
      displayName: 'Alice',
      shareHandle: 'alice',
      avatarUrl: 'https://cdn.example.com/u_1.jpg',
      biography: 'Loves books.',
      city: 'IL-001',
      cityName: 'Tel Aviv',
      followersCount: 10,
      itemsGivenCount: 4,
      verificationLevel: 1,
    });
  });

  it('passes through null avatar_url', () => {
    const out = mapUserSearchResult(makeUserRow({ avatar_url: null }));
    expect(out.avatarUrl).toBeNull();
  });

  it('passes through null biography', () => {
    const out = mapUserSearchResult(makeUserRow({ biography: null }));
    expect(out.biography).toBeNull();
  });

  it('preserves zero counters (followersCount, itemsGivenCount)', () => {
    const out = mapUserSearchResult(makeUserRow({
      followers_count: 0,
      items_given_count: 0,
    }));
    expect(out.followersCount).toBe(0);
    expect(out.itemsGivenCount).toBe(0);
  });
});

describe('mapLinkSearchResult', () => {
  it('maps every column to its DonationLinkSearchResult field on the happy path', () => {
    const out = mapLinkSearchResult(makeLinkRow());

    expect(out).toEqual({
      id: 'l_1',
      categorySlug: 'food',
      url: 'https://example.org/donate',
      displayName: 'Food bank',
      description: 'Supports families in need.',
      tags: 'tag1, tag2',
    });
  });

  describe('categorySlug passthrough', () => {
    // The mapper exposes only the locale-agnostic slug (TD-155); the FE
    // resolves the display label via `t('search.donationCategories.<slug>')`.
    it.each(['time', 'money', 'food', 'housing', 'transport', 'knowledge', 'animals', 'medical'])(
      'passes the %s slug through verbatim',
      (slug) => {
        const out = mapLinkSearchResult(makeLinkRow({ category_slug: slug }));
        expect(out.categorySlug).toBe(slug);
      },
    );

    it('passes a future / unknown DB slug through verbatim instead of crashing', () => {
      const out = mapLinkSearchResult(makeLinkRow({ category_slug: 'brand-new-slug' }));
      expect(out.categorySlug).toBe('brand-new-slug');
    });
  });

  describe('nullable fields', () => {
    it('passes through null description', () => {
      const out = mapLinkSearchResult(makeLinkRow({ description: null }));
      expect(out.description).toBeNull();
    });

    it('coalesces undefined tags to null', () => {
      // tags is `string | null | undefined` on the row; the mapper guarantees
      // a `string | null` on the result so consumers don't have to handle
      // a tri-state.
      const { tags: _omitted, ...rest } = makeLinkRow();
      const out = mapLinkSearchResult(rest as unknown as LinkRow);
      expect(out.tags).toBeNull();
    });

    it('passes through null tags verbatim', () => {
      const out = mapLinkSearchResult(makeLinkRow({ tags: null }));
      expect(out.tags).toBeNull();
    });

    it('passes through a populated tags string verbatim', () => {
      const out = mapLinkSearchResult(makeLinkRow({ tags: 'a,b,c' }));
      expect(out.tags).toBe('a,b,c');
    });
  });
});
