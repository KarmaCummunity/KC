import { describe, expect, it } from 'vitest';
import { hasUniversalSearchResults } from '../universalSearchResults';
import type { UniversalSearchResults } from '@kc/application';

const emptyResults: UniversalSearchResults = {
  posts: [],
  users: [],
  links: [],
  orgs: [],
  hashtags: [],
  suggestedQueries: [],
  postsTotal: 0,
  usersTotal: 0,
  linksTotal: 0,
  orgsTotal: 0,
  hashtagsTotal: 0,
};

describe('hasUniversalSearchResults', () => {
  it('returns false when undefined or all buckets empty', () => {
    expect(hasUniversalSearchResults(undefined)).toBe(false);
    expect(hasUniversalSearchResults(emptyResults)).toBe(false);
  });

  it('returns true when any bucket has rows', () => {
    expect(
      hasUniversalSearchResults({
        ...emptyResults,
        hashtags: [{ tag: 'kc', useCount: 1 }],
      }),
    ).toBe(true);
  });
});
