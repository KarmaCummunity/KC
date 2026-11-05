// Where a listing card's fields come from (G1 step 6a-5h, D-214).
//
// A post-owned listing (origin 'native' with legacy_post_id: food, rides, housing, time since
// migration 0554) is derived from its post, and both database syncs keep the fields a card shows
// equal on the two sides. For that shape the card reads the post: world, kind, direction, urgency,
// availability, ride details and publisher. Title, summary and city stay the listing's — a listing
// made post-owned by the 0554 backfill may still differ from its post there (0629). Every other
// shape (mirrors of listing-sourced listings, items, v1 rides) reads the listing, as the server
// readers do since 0629–0632.
//
// The post is embedded through listings.legacy_post_id, so a card page stays one request. The
// embed runs under the posts RLS policy (is_post_visible_to); for a post-owned listing that is the
// rule the listings policy already applies (is_listing_visible_to, 0628), so a visible card has a
// visible post. If the post still comes back hidden, the card falls back to the listing's fields.

/** The owner embed PostgREST returns: an object, or a one-element array. */
export type PublisherEmbed = { display_name: string | null; avatar_url: string | null };

type OneOf<T> = T | T[] | null | undefined;

/** The listing's owner. RLS on `users` (users_select_active) returns null for a hidden owner. */
export const LISTING_PUBLISHER_EMBED = 'publisher:users!listings_owner_id_fkey(display_name, avatar_url)';

/** The post a listing is derived from, with its kind and its owner. */
export const CARD_POST_EMBED =
  'post:posts!listings_legacy_post_id_fkey(world_slug, direction, urgency_level, availability_status, details, ' +
  'kind:listing_kinds!posts_kind_id_fkey(slug), publisher:users!posts_owner_id_fkey(display_name, avatar_url))';

export type CardPostEmbed = {
  world_slug: string;
  direction: string;
  urgency_level: number | null;
  availability_status: string;
  details: unknown;
  kind?: OneOf<{ slug: string }>;
  publisher?: OneOf<PublisherEmbed>;
};

/** The listing columns that tell its shape, and the embedded post. */
export type CardShapeColumns = {
  origin?: string | null;
  legacy_post_id?: string | null;
  post?: OneOf<CardPostEmbed>;
};

export function firstOf<T>(value: OneOf<T>): T | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/** The post that is the listing's record, or null when the listing reads itself. */
export function recordPostOf(row: CardShapeColumns): CardPostEmbed | null {
  if (row.origin !== 'native' || !row.legacy_post_id) return null;
  return firstOf(row.post);
}

/** A post's direction in the listing's words (`offer` is the listing's `give`). */
export function listingDirectionOf(postDirection: string): 'give' | 'request' {
  return postDirection === 'request' ? 'request' : 'give';
}
