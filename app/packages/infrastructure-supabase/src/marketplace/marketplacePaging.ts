// Keyset-paginated marketplace reads (browse, search, my listings) + batched cards.
// Cursors mirror the ORDER BY of the server RPCs (0410, 0411, 0413); see those
// migrations for the exact sort keys.

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  MarketplaceBrowseCursor,
  MarketplaceBrowseFilters,
  MarketplacePage,
  MarketplaceSearchCursor,
  MyListingsCursor,
} from '@kc/application';
import type { ListingCardPublisher, MarketplaceBrowseRow, MyListingRow, RideCardSummary } from '@kc/domain';
import type { Database } from '../database.types';
import {
  CARD_POST_EMBED,
  LISTING_PUBLISHER_EMBED,
  listingDirectionOf,
  recordPostOf,
  type CardShapeColumns,
  type PublisherEmbed,
} from './listingCardSource';

type Client = SupabaseClient<Database>;
type BrowseRow = Database['public']['Functions']['browse_listings']['Returns'][number];
type MyRow = Database['public']['Functions']['list_my_listings']['Returns'][number];

export function mapBrowseRow(row: BrowseRow): MarketplaceBrowseRow {
  return {
    listingId: row.listing_id,
    worldSlug: row.world_slug,
    kindSlug: row.kind_slug,
    direction: row.direction as 'give' | 'request',
    title: row.title,
    summary: row.summary,
    urgencyLevel: row.urgency_level,
    availabilityStatus: row.availability_status,
    cityId: row.city_id,
    distanceKm: row.distance_km,
  };
}

function mapMyRow(r: MyRow): MyListingRow {
  return {
    listingId: r.listing_id,
    worldSlug: r.world_slug,
    kindSlug: r.kind_slug,
    direction: r.direction as 'give' | 'request',
    status: r.status,
    title: r.title,
    summary: r.summary,
    urgencyLevel: r.urgency_level,
    availabilityStatus: r.availability_status,
    updatedAt: r.updated_at,
  };
}

/** Next cursor when the page came back full; null on the last page. */
export function browseCursorFrom(rows: readonly BrowseRow[], limit: number): MarketplaceBrowseCursor | null {
  const last = rows[rows.length - 1];
  if (!last || rows.length < limit) return null;
  return {
    sortKey: last.sort_key,
    urgencyLevel: last.urgency_level,
    createdAt: last.created_at,
    listingId: last.listing_id,
  };
}

export async function fetchBrowsePage(
  client: Client,
  filters: MarketplaceBrowseFilters,
): Promise<MarketplacePage<MarketplaceBrowseRow, MarketplaceBrowseCursor>> {
  const limit = filters.limit ?? 24;
  const c = filters.cursor ?? null;
  const { data, error } = await client.rpc('browse_listings', {
    p_world_slug: filters.worldSlug ?? undefined,
    p_direction: filters.direction ?? undefined,
    p_urgency_min: filters.urgencyMin ?? undefined,
    p_availability: filters.availability ?? undefined,
    p_lat: filters.lat ?? undefined,
    p_lng: filters.lng ?? undefined,
    p_radius_km: filters.radiusKm ?? undefined,
    p_category_id: filters.categoryId ?? undefined,
    p_limit: limit,
    p_offset: c ? 0 : (filters.offset ?? 0),
    p_cursor_sort: c?.sortKey,
    p_cursor_urgency: c?.urgencyLevel,
    p_cursor_created_at: c?.createdAt,
    p_cursor_id: c?.listingId,
  });
  if (error || !data) return { rows: [], nextCursor: null };
  const rows = await attachCardExtras(client, data.map(mapBrowseRow));
  return { rows, nextCursor: browseCursorFrom(data, limit) };
}

export async function fetchSearchPage(
  client: Client,
  query: string,
  worldSlug: string | null,
  limit: number,
  cursor?: MarketplaceSearchCursor | null,
): Promise<MarketplacePage<string, MarketplaceSearchCursor>> {
  const { data, error } = await client.rpc('marketplace_search', {
    p_query: query,
    p_world_slug: worldSlug ?? undefined,
    p_limit: limit,
    p_cursor_score: cursor?.score,
    p_cursor_id: cursor?.listingId,
  });
  if (error || !data) return { rows: [], nextCursor: null };
  const last = data[data.length - 1];
  const nextCursor =
    last && data.length >= limit ? { score: Number(last.rrf_score), listingId: last.listing_id } : null;
  return { rows: data.map((r) => r.listing_id), nextCursor };
}

type CardRow = CardShapeColumns & {
  listing_id: string;
  world_slug: string;
  direction: string;
  title: string;
  summary: string | null;
  urgency_level: number;
  availability_status: string;
  city_id: string | null;
  details?: unknown;
  kind: { slug: string } | Array<{ slug: string }> | null;
  publisher?: PublisherEmbed | PublisherEmbed[] | null;
};

/** A card from a listing row: the post's fields when it is the record (listingCardSource). */
function mapCardRow(r: CardRow): MarketplaceBrowseRow {
  const post = recordPostOf(r);
  const kind = Array.isArray(r.kind) ? r.kind[0] : r.kind;
  const postKind = post ? (Array.isArray(post.kind) ? post.kind[0] : post.kind) : null;
  const worldSlug = post ? post.world_slug : r.world_slug;
  const details = post ? post.details : r.details;
  return {
    listingId: r.listing_id,
    worldSlug,
    kindSlug: (post ? postKind?.slug : kind?.slug) ?? '',
    direction: post ? listingDirectionOf(post.direction) : (r.direction as 'give' | 'request'),
    title: r.title,
    summary: r.summary,
    urgencyLevel: post?.urgency_level ?? r.urgency_level,
    availabilityStatus: post ? post.availability_status : r.availability_status,
    cityId: r.city_id,
    distanceKm: null,
    ride: worldSlug === 'rides' ? rideSummaryFromDetails(details as RideDetails | null) : null,
    publisher: mapCardPublisher(post ? post.publisher : r.publisher),
  };
}

/** One query for N cards (was 2 queries per card), returned in `ids` order. */
export async function fetchListingCards(
  client: Client,
  ids: readonly string[],
): Promise<MarketplaceBrowseRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client
    .from('listings')
    .select(
      `listing_id, world_slug, direction, title, summary, urgency_level, availability_status, city_id, details, origin, legacy_post_id, kind:listing_kinds(slug), ${LISTING_PUBLISHER_EMBED}, ${CARD_POST_EMBED}`,
    )
    .in('listing_id', [...ids]);
  if (error || !data) return [];
  const byId = new Map<string, MarketplaceBrowseRow>();
  for (const r of data as unknown as CardRow[]) byId.set(r.listing_id, mapCardRow(r));
  return ids.map((id) => byId.get(id)).filter((r): r is MarketplaceBrowseRow => r !== undefined);
}

export async function fetchMyListingsPage(
  client: Client,
  limit: number,
  cursor?: MyListingsCursor | null,
  offset = 0,
): Promise<MarketplacePage<MyListingRow, MyListingsCursor>> {
  const { data, error } = await client.rpc('list_my_listings', {
    p_limit: limit,
    p_offset: cursor ? 0 : offset,
    p_cursor_updated_at: cursor?.updatedAt,
    p_cursor_id: cursor?.listingId,
  });
  if (error || !data) return { rows: [], nextCursor: null };
  const rows = data.map(mapMyRow);
  const last = rows[rows.length - 1];
  return {
    rows,
    nextCursor: last && rows.length >= limit ? { updatedAt: last.updatedAt, listingId: last.listingId } : null,
  };
}

type RideDetails = {
  origin_label?: string; dest_label?: string; departs_at?: string;
  seats_available?: number; passengers?: number;
};

/** Pure mapper from listing `details` jsonb to the card summary. */
export function rideSummaryFromDetails(d: RideDetails | null | undefined): RideCardSummary | null {
  if (!d) return null;
  let seats: number | null = null;
  if (typeof d.seats_available === 'number') seats = d.seats_available;
  else if (typeof d.passengers === 'number') seats = d.passengers;
  return {
    originLabel: d.origin_label?.trim() || null,
    destLabel: d.dest_label?.trim() || null,
    departsAt: d.departs_at || null,
    seats,
  };
}

/** Pure mapper from the owner embed (an object, or a one-element array) to the card's publisher. */
export function mapCardPublisher(
  embed: PublisherEmbed | PublisherEmbed[] | null | undefined,
): ListingCardPublisher | null {
  const owner = Array.isArray(embed) ? embed[0] : embed;
  if (!owner) return null;
  return { displayName: owner.display_name?.trim() || null, avatarUrl: owner.avatar_url || null };
}

/**
 * Attach what the browse RPC does not return to its rows, in one batched, RLS-scoped read: every
 * row's publisher, and a ride's route, time and seats. On any failure the rows come back unchanged,
 * so the cards still render, only without these lines.
 */
export async function attachCardExtras(
  client: Client,
  rows: MarketplaceBrowseRow[],
): Promise<MarketplaceBrowseRow[]> {
  if (rows.length === 0) return rows;
  let data: unknown[] | null;
  try {
    const res = await client
      .from('listings')
      .select(`listing_id, details, origin, legacy_post_id, ${LISTING_PUBLISHER_EMBED}, ${CARD_POST_EMBED}`)
      .in('listing_id', rows.map((r) => r.listingId));
    if (res.error) return rows;
    data = res.data;
  } catch {
    return rows;
  }
  if (!data) return rows;
  type ExtrasRow = CardShapeColumns & {
    listing_id: string;
    details: unknown;
    publisher?: PublisherEmbed | PublisherEmbed[] | null;
  };
  const byId = new Map<string, ExtrasRow>();
  for (const r of data as ExtrasRow[]) byId.set(r.listing_id, r);
  return rows.map((r) => {
    const extras = byId.get(r.listingId);
    if (!extras) return r;
    // The post's details and owner when it is the listing's record (listingCardSource).
    const post = recordPostOf(extras);
    const details = post ? post.details : extras.details;
    const ride = r.worldSlug === 'rides' ? { ride: rideSummaryFromDetails((details ?? null) as RideDetails | null) } : {};
    return { ...r, ...ride, publisher: mapCardPublisher(post ? post.publisher : extras.publisher) };
  });
}
