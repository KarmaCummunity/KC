// Mapped to spec: FR-DONATE-007 / FR-KNOW-* — the "community links" screen of a giving world lists
// the world's curated links next to the knowledge posts that are relevant to the same subject.
// This module holds the pure search / item-type filter / sort rules of that screen so the UI
// (and its tests) share one definition.
import { normalizeKnowledgeText, type DonationLink } from '@kc/domain';

/** Sort orders offered on the links screen (links and info posts share them). */
export type WorldLinksSort = 'newest' | 'oldest' | 'alpha';

/** Item-type filter: everything, community links only, or knowledge (info) posts only. */
export type WorldLinksKind = 'all' | 'links' | 'posts';

export const WORLD_LINKS_SORTS: readonly WorldLinksSort[] = ['newest', 'oldest', 'alpha'];
export const WORLD_LINKS_KINDS: readonly WorldLinksKind[] = ['all', 'links', 'posts'];

/** Shortest query that narrows the list (matches the feed's own minimum). */
export const WORLD_LINKS_MIN_QUERY = 2;

/** Hostname of a URL, or '' when it does not parse (the URL itself is then still searchable). */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * True when every word of `query` appears in the normalized haystack. Word-wise AND matching
 * lets "dog adoption" find "Adoption of a dog"; normalization folds Hebrew final letters and
 * niqqud so typing style does not matter. Queries shorter than the minimum match everything.
 */
export function matchesWorldLinksQuery(query: string, ...fields: ReadonlyArray<string | null | undefined>): boolean {
  const needle = normalizeKnowledgeText(query);
  if (needle.length < WORLD_LINKS_MIN_QUERY) return true;
  const haystack = normalizeKnowledgeText(fields.join(' '));
  return needle.split(' ').every((word) => haystack.includes(word));
}

/** Comparator for the chosen order over `{ label, createdAt }` rows; Hebrew-aware for A-Z. */
function comparator(sort: WorldLinksSort) {
  return (a: { label: string; createdAt: string }, b: { label: string; createdAt: string }): number => {
    if (sort === 'alpha') return a.label.localeCompare(b.label, 'he');
    const byDate = a.createdAt.localeCompare(b.createdAt); // ISO-8601 strings sort chronologically
    return sort === 'oldest' ? byDate : -byDate;
  };
}

/** Searches (name, description, host) and sorts community links; never mutates the input. */
export function filterAndSortLinks(
  links: readonly DonationLink[],
  options: { readonly query: string; readonly sort: WorldLinksSort },
): DonationLink[] {
  const compare = comparator(options.sort);
  return links
    .filter((link) => matchesWorldLinksQuery(options.query, link.displayName, link.description, hostOf(link.url)))
    .sort((a, b) =>
      compare({ label: a.displayName, createdAt: a.createdAt }, { label: b.displayName, createdAt: b.createdAt }),
    );
}

/** The minimal post shape this screen needs (a structural subset of `PostWithOwner`). */
export interface InfoPostLike {
  readonly title: string;
  readonly description: string | null;
  readonly createdAt: string;
}

/** Searches (title, description) and sorts knowledge posts; never mutates the input. */
export function filterAndSortInfoPosts<T extends InfoPostLike>(
  posts: readonly T[],
  options: { readonly query: string; readonly sort: WorldLinksSort },
): T[] {
  const compare = comparator(options.sort);
  return posts
    .filter((post) => matchesWorldLinksQuery(options.query, post.title, post.description))
    .sort((a, b) => compare({ label: a.title, createdAt: a.createdAt }, { label: b.title, createdAt: b.createdAt }));
}

/** Which sections the item-type filter shows. */
export function visibleSections(kind: WorldLinksKind): { readonly links: boolean; readonly posts: boolean } {
  return { links: kind !== 'posts', posts: kind !== 'links' };
}
