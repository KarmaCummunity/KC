// Shares one listing-detail read between the post screen and the listing screen.
//
// Opening a post of a listing world runs two read chains in sequence: the post screen's card read
// and then, once the card names a listing world, the listing screen's `post_detail` chain. The post
// read calls `warmListingDetail` the moment its card shows the post is a listing, so the listing
// chain runs next to the rest of the post read instead of after it. The listing screen then takes
// that in-flight read. An entry is used once and only while it is young; after that the screen
// reads afresh, so a detail never outlives the open that started it (NFR-PERF-005).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MarketplaceListingDetail } from '@kc/domain';
import type { Database } from '../database.types';
import { fetchListingDetail } from './mapListingDetail';

type Client = SupabaseClient<Database>;
type Warm = { readonly startedAt: number; readonly read: Promise<MarketplaceListingDetail | null> };

/** How long a started read may be taken over: covers the post read, not a later visit. */
export const WARM_LISTING_DETAIL_TTL_MS = 5_000;

const warmReads = new WeakMap<object, Map<string, Warm>>();

function entriesOf(client: Client): Map<string, Warm> {
  let entries = warmReads.get(client);
  if (!entries) {
    entries = new Map();
    warmReads.set(client, entries);
  }
  return entries;
}

/** Starts the detail read of `listingId` ahead of its screen; a second call while one is young is a no-op. */
export function warmListingDetail(client: Client, listingId: string, now: number = Date.now()): void {
  const entries = entriesOf(client);
  const existing = entries.get(listingId);
  if (existing && now - existing.startedAt < WARM_LISTING_DETAIL_TTL_MS) return;
  const read = fetchListingDetail(client, listingId);
  const entry: Warm = { startedAt: now, read };
  entries.set(listingId, entry);
  // A read nobody takes must not surface as an unhandled rejection, and a failed one is dropped.
  read.catch(() => {
    if (entries.get(listingId) === entry) entries.delete(listingId);
  });
}

/** The detail of a listing: the warmed read when one is young (taken once), otherwise a fresh read. */
export function readListingDetail(client: Client, listingId: string, now: number = Date.now()): Promise<MarketplaceListingDetail | null> {
  const entries = entriesOf(client);
  const warm = entries.get(listingId);
  entries.delete(listingId);
  if (warm && now - warm.startedAt < WARM_LISTING_DETAIL_TTL_MS) return warm.read;
  return fetchListingDetail(client, listingId);
}
