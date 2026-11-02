/**
 * GetFeedUseCase — orchestrates a feed page read against IPostRepository.
 * Mapped to FR-FEED-001, 002, 004, 005, 006.
 *
 * The use case is pure orchestration: clamps the page limit and normalizes
 * the filter shape (drops empty arrays and blank strings so the adapter sees
 * `undefined` for "no filter" rather than meaningless empties).
 */

import type {
  FeedPage,
  IPostRepository,
  PostFeedFilter,
} from '../ports/IPostRepository';

export interface GetFeedInput {
  viewerId: string | null;
  filter: PostFeedFilter;
  limit?: number;
  cursor?: string;
}

const DEFAULT_LIMIT = 20;
const HARD_MAX = 100;

export class GetFeedUseCase {
  constructor(private readonly repo: IPostRepository) {}

  async execute(input: GetFeedInput): Promise<FeedPage> {
    const limit = clamp(input.limit ?? DEFAULT_LIMIT, 1, HARD_MAX);
    const filter = normalizeFilter(input.filter);
    return this.repo.getFeed(input.viewerId, filter, limit, input.cursor);
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

function normalizeFilter(raw: PostFeedFilter): PostFeedFilter {
  const out: PostFeedFilter = { ...raw };

  // Drop empty array filters — they mean "no filter" and confuse downstream.
  if (Array.isArray(out.categories) && out.categories.length === 0) {
    delete out.categories;
  }
  if (Array.isArray(out.worlds) && out.worlds.length === 0) {
    delete out.worlds;
  }
  if (Array.isArray(out.subcategories) && out.subcategories.length === 0) {
    delete out.subcategories;
  }
  if (Array.isArray(out.itemConditions) && out.itemConditions.length === 0) {
    delete out.itemConditions;
  }

  // Item condition is only meaningful for Give posts on items world (or when no world filter set).
  if (out.itemConditions) {
    const isItemsWorld = !out.worlds?.length || out.worlds.includes('items');
    if (out.type !== 'Give' || !isItemsWorld) {
      delete out.itemConditions;
    }
  }

  // Drop blank explicit proximity city — let the adapter fall back to the
  // viewer's own city.
  if (typeof out.proximitySortCity === 'string' && out.proximitySortCity.trim() === '') {
    delete out.proximitySortCity;
  }

  // Drop incoherent location filters (missing center or non-positive radius).
  if (out.locationFilter) {
    const { centerCity, radiusKm } = out.locationFilter;
    if (!centerCity || typeof centerCity !== 'string' || !(radiusKm > 0)) {
      delete out.locationFilter;
    }
  }

  if (typeof out.searchQuery === 'string') {
    const q = out.searchQuery.trim();
    if (q.length < 2) delete out.searchQuery;
    else out.searchQuery = q;
  }

  return out;
}
