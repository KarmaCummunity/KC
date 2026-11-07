// Mapped to spec: FR-FEED-021 — the map shows the posts of the feed that opened it, with its filter,
// and the filter stays editable on the map.
import type { MarketplaceMapPin } from '@kc/domain';
import type { PostFeedFilter, PostWithOwner } from '@kc/application';
import type { PostFilterValue } from '../components/PostFilterSheet';
import { countWorldPostFilters, worldFeedFilter, worldPostFilterDefaults } from './worldPostFeed';

/** A feed post as a map pin; `listingId` carries the post id (the pin's key). Null when it has no position. */
export function postToMapPin(post: PostWithOwner): MarketplaceMapPin | null {
  const point = post.mapPoint;
  if (!point) return null;
  return {
    listingId: post.postId,
    worldSlug: post.listingWorldSlug ?? 'items',
    kindSlug: '',
    direction: post.type === 'Request' ? 'request' : 'give',
    title: post.title,
    summary: post.description,
    lat: point.lat,
    lng: point.lng,
    route: null,
    ride: null,
  };
}

export function postsToMapPins(posts: readonly PostWithOwner[]): MarketplaceMapPin[] {
  const pins: MarketplaceMapPin[] = [];
  for (const p of posts) {
    const pin = postToMapPin(p);
    if (pin) pins.push(pin);
  }
  return pins;
}

/** The opening feed's filter sheet value as a route param, so the map starts on the same query. */
export function encodeMapFilter(value: PostFilterValue): string {
  return JSON.stringify(value);
}

/** Route params → the sheet value. A locked `world` (a world's map) always keeps that world. */
export function decodeMapFilter(raw: unknown, world: string | null): PostFilterValue {
  const defaults = worldPostFilterDefaults(world ?? '');
  const base: PostFilterValue = world ? defaults : { ...defaults, worlds: [] };
  if (typeof raw === 'string' && raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const merged = { ...base, ...(parsed as Partial<PostFilterValue>) };
        return world ? { ...merged, worlds: [world] } : merged;
      }
    } catch {
      // Malformed param: start from the defaults.
    }
  }
  return base;
}

/** The feed query for the sheet value: a world's map is narrowed to the world, the main map is not. */
export function mapFeedFilter(value: PostFilterValue, world: string | null): PostFeedFilter {
  if (world) return worldFeedFilter(world, value);
  return { ...worldFeedFilter('', value), worlds: value.worlds ?? [] };
}

/** The filter button's badge, counted as the opening feed counts it. */
export function mapFilterCount(value: PostFilterValue, world: string | null): number {
  const worldPicked = !world && (value.worlds?.length ?? 0) > 0;
  return countWorldPostFilters(value) + (worldPicked ? 1 : 0);
}
