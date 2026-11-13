// Post cards → the marketplace's listing rows.
//
// A listing is a post (design §8): its id is the post id, its world the post's world. The
// marketplace screens keep their own words for the direction (give / request) and for
// `availabilityStatus`, so this module is the one place that translates a `post_card` into
// them. The status of a listing is the status of its post, unchanged (issue #2204).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MarketplaceSimilarListing, MyListingRow, ProfileListingRow } from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import type { PostCardRow } from '../posts/mapPostRow';
import { listingDirectionOf, type KindCatalog } from './kindCatalog';

type Client = SupabaseClient<Database>;

/** Urgency a post without one is shown with (the middle of 1..3). */
const DEFAULT_URGENCY = 2;

/** The availability word of a post status: only a paused post is "paused"; the rest read as ongoing. */
export function availabilityOf(postStatus: string | null | undefined): string {
  return postStatus === 'paused' ? 'paused' : 'ongoing';
}

/** The kind slug of a card (`''` when the catalog does not hold the kind). */
function kindSlugOf(card: PostCardRow, kinds: KindCatalog): string {
  return (card.kind_id ? kinds.byId.get(card.kind_id)?.slug : undefined) ?? '';
}

/**
 * A card as a row of the member's own listings. The card carries the creation time only, so the
 * list is ordered, and `updatedAt` stated, by it.
 */
export function cardToMyListingRow(card: PostCardRow, kinds: KindCatalog): MyListingRow {
  return {
    listingId: card.id ?? '',
    worldSlug: card.world_slug ?? '',
    kindSlug: kindSlugOf(card, kinds),
    direction: listingDirectionOf(card.direction),
    status: card.status ?? 'open',
    title: card.title ?? '',
    summary: card.description,
    urgencyLevel: card.urgency_level ?? DEFAULT_URGENCY,
    availabilityStatus: availabilityOf(card.status),
    updatedAt: card.created_at ?? '',
    feedPostId: card.id,
  };
}

/** A card as a row of a member's public listings (profile). */
export function cardToProfileListingRow(card: PostCardRow, kinds: KindCatalog): ProfileListingRow {
  return {
    listingId: card.id ?? '',
    worldSlug: card.world_slug ?? '',
    kindSlug: kindSlugOf(card, kinds),
    direction: listingDirectionOf(card.direction),
    status: card.status ?? 'open',
    title: card.title ?? '',
    summary: card.description,
  };
}

/** A card as a "more like this" entry. */
export function cardToSimilarListing(card: PostCardRow, kinds: KindCatalog): MarketplaceSimilarListing {
  return {
    listingId: card.id ?? '',
    title: card.title ?? '',
    worldSlug: card.world_slug ?? '',
    kindSlug: kindSlugOf(card, kinds),
  };
}

/** The cards of `ids` the caller may read, in the order of `ids`. */
export async function fetchCardsInOrder(client: Client, ids: readonly string[]): Promise<PostCardRow[]> {
  if (ids.length === 0) return [];
  const cards = unwrapCall('rpc:post_cards', await client.rpc('post_cards', { p_post_ids: [...ids] })) ?? [];
  const byId = new Map(cards.map((card) => [card.id, card]));
  return ids.flatMap((id) => {
    const card = byId.get(id);
    return card ? [card] : [];
  });
}
