// The owner's own photo as the cover of their card while it still waits for processing (KC#2316).
//
// Cards carry only `ready` files (`post_cards`), and nothing yet moves an upload out of `pending`,
// so a member's freshly published photo post showed no picture even to its author. For the cards
// of a page that have no cover, this reads the first gallery file (`ordinal = 0`) with the caller's
// own rights: the `post_media` policy returns another member's file only once it is `ready` (and
// then the card already has it as its cover), so every row found here is the caller's own upload.
// Nothing becomes visible to anyone else. One query per page, and none when every card has a cover.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import type { PostCardRow } from './mapPostRow';

type Client = SupabaseClient<Database>;
type CoverRow = Pick<Database['public']['Tables']['post_media']['Row'], 'id' | 'post_id' | 'kind' | 'storage_bucket' | 'storage_key'>;

/** The cards of a page, each without a cover given the caller's own first photo when there is one. */
export async function withOwnPendingCovers(
  client: Client,
  cards: readonly PostCardRow[],
): Promise<readonly PostCardRow[]> {
  const coverless = cards.flatMap((card) => (card.id !== null && card.cover_media == null ? [card.id] : []));
  if (coverless.length === 0) return cards;
  let rows: readonly CoverRow[] | null;
  try {
    rows = unwrapCall(
      'table:post_media',
      await client
        .from('post_media')
        .select('id, post_id, kind, storage_bucket, storage_key')
        .in('post_id', coverless)
        .eq('ordinal', 0)
        .eq('kind', 'image'),
    );
  } catch (err) {
    // An optional enrichment: a failed read leaves the page as the server sent it, never fails it.
    console.warn('[posts] own pending covers unavailable', err instanceof Error ? err.message : err);
    return cards;
  }
  if (!rows || rows.length === 0) return cards;
  const coverByPost = new Map<string, Json>(
    rows.map((row) => [
      row.post_id,
      { id: row.id, kind: row.kind, storage_bucket: row.storage_bucket, storage_key: row.storage_key },
    ]),
  );
  return cards.map((card) => {
    const cover = card.id !== null && card.cover_media == null ? coverByPost.get(card.id) : undefined;
    return cover === undefined ? card : { ...card, cover_media: cover };
  });
}
