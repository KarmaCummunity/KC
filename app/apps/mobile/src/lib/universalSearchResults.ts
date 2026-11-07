import type { UniversalSearchResults } from '@kc/application';

export function hasUniversalSearchResults(results: UniversalSearchResults | undefined): boolean {
  if (!results) return false;
  return Boolean(
    results.posts.length
      || results.users.length
      || results.links.length
      || results.orgs.length
      || results.hashtags.length,
  );
}
