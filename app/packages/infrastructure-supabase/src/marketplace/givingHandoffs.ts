// Item and food handoffs on the shared `post_handoffs` table (machine `giving_handoff`).
//
// A handoff is the closing stage of a post: who reserved it, when, and how it ended. Every change
// is an RPC that returns the updated row; a refusal is a stable reason (`BackendRuleError`), which
// the screens map to copy through `handoffErrorKey`. Split out of SupabaseMarketplaceRepository
// for the 300-line cap.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { GivingHandoffSnapshot, MyGivingHandoffRow } from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { sessionUserId } from '../users/userReads';
import { requireRpcRow } from './rpcRow';

type Client = SupabaseClient<Database>;
export type HandoffRow = Database['public']['Tables']['post_handoffs']['Row'];

/** The handoff states in which the post is still spoken for or was delivered (a cancelled one is gone). */
const KEPT_STATUSES = ['reserved', 'confirmed', 'handed_over', 'no_show'] as const;

/** The world of a post; `''` when the caller cannot read it any more. */
async function postWorldSlug(client: Client, postId: string): Promise<string> {
  const row = unwrapCall(
    'table:posts',
    await client.from('posts').select('world_slug').eq('id', postId).maybeSingle(),
  );
  return row?.world_slug ?? '';
}

/** A handoff row as the app's snapshot; `worldSlug` is the world of the handoff's post. */
export function mapHandoffRow(row: HandoffRow, worldSlug: string): GivingHandoffSnapshot {
  return {
    handoffId: row.id,
    listingId: row.post_id,
    ownerId: row.owner_id,
    recipientId: row.recipient_id,
    worldSlug,
    status: row.status,
    pickupMode: row.pickup_mode,
    pickupWindowStart: row.pickup_window_start,
    pickupWindowEnd: row.pickup_window_end,
    confirmBy: row.confirm_by,
    reservedAt: row.created_at,
    confirmedAt: row.confirmed_at,
  };
}

/** The snapshot of an RPC's answer; the post's world is one extra read. */
async function snapshotOf(client: Client, row: HandoffRow): Promise<GivingHandoffSnapshot> {
  return mapHandoffRow(row, await postWorldSlug(client, row.post_id));
}

/**
 * The caller's handoff of the post: their reservation, or — for the owner — the post's current
 * one. A cancelled handoff does not count, so the member can reserve again. Null when none.
 */
export async function getListingHandoff(client: Client, listingId: string): Promise<GivingHandoffSnapshot | null> {
  const row = unwrapCall(
    'table:post_handoffs',
    await client
      .from('post_handoffs')
      .select('*')
      .eq('post_id', listingId)
      .in('status', [...KEPT_STATUSES])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  return row ? snapshotOf(client, row) : null;
}

/** The caller's handoffs as owner or recipient (the table shows a party only its own), newest first. */
export async function listMyGivingHandoffs(client: Client, limit = 50): Promise<MyGivingHandoffRow[]> {
  const userId = await sessionUserId(client);
  if (!userId) return [];
  const rows = unwrapCall(
    'table:post_handoffs',
    await client
      .from('post_handoffs')
      .select('*, posts(title, world_slug)')
      .order('created_at', { ascending: false })
      .limit(limit),
  );
  return (rows ?? []).flatMap((row) => {
    // A post the caller can no longer read cannot be titled, so its handoff is left out.
    const post = Array.isArray(row.posts) ? row.posts[0] : row.posts;
    if (!post) return [];
    return [
      {
        handoffId: row.id,
        listingId: row.post_id,
        title: post.title,
        worldSlug: post.world_slug,
        status: row.status,
        role: row.owner_id === userId ? ('owner' as const) : ('recipient' as const),
        pickupWindowStart: row.pickup_window_start,
        pickupWindowEnd: row.pickup_window_end,
        reservedAt: row.created_at,
      },
    ];
  });
}

/** Reserves an item for the caller; the owner confirms or lets it lapse. */
export async function reserveItemGiving(
  client: Client,
  listingId: string,
  pickupMode: 'pickup' | 'delivery' = 'pickup',
  pickupWindowStart?: string | null,
  pickupWindowEnd?: string | null,
): Promise<GivingHandoffSnapshot> {
  const row = requireRpcRow(
    unwrapCall(
    'rpc:reserve_item_giving',
    await client.rpc('reserve_item_giving', {
      p_post_id: listingId,
      p_pickup_mode: pickupMode,
      p_pickup_window_start: pickupWindowStart ?? undefined,
      p_pickup_window_end: pickupWindowEnd ?? undefined,
    }),
  ), 'rpc:reserve_item_giving');
  return snapshotOf(client, row);
}

/** The owner confirms a waiting reservation. */
export async function confirmItemHandoff(client: Client, handoffId: string): Promise<GivingHandoffSnapshot> {
  const row = requireRpcRow(
    unwrapCall('rpc:confirm_item_handoff', await client.rpc('confirm_item_handoff', { p_handoff_id: handoffId })),
    'confirm_item_handoff',
  );
  return snapshotOf(client, row);
}

/** Claims a food offer for the caller. */
export async function claimFoodGiving(
  client: Client,
  listingId: string,
  pickupWindowStart?: string | null,
  pickupWindowEnd?: string | null,
): Promise<GivingHandoffSnapshot> {
  const row = requireRpcRow(
    unwrapCall(
    'rpc:claim_food_giving',
    await client.rpc('claim_food_giving', {
      p_post_id: listingId,
      p_pickup_window_start: pickupWindowStart ?? undefined,
      p_pickup_window_end: pickupWindowEnd ?? undefined,
    }),
  ), 'rpc:claim_food_giving');
  return snapshotOf(client, row);
}

/** Either side cancels a live handoff; the post goes back on the air. */
export async function cancelGivingHandoff(client: Client, handoffId: string): Promise<void> {
  unwrapCall('rpc:cancel_giving_handoff', await client.rpc('cancel_giving_handoff', { p_handoff_id: handoffId }));
}

/** Marks the item as handed over (owner or recipient); the post closes as delivered. */
export async function markGivingHandedOver(client: Client, handoffId: string): Promise<GivingHandoffSnapshot> {
  const row = requireRpcRow(
    unwrapCall(
    'rpc:mark_giving_handed_over',
    await client.rpc('mark_giving_handed_over', { p_handoff_id: handoffId }),
  ), 'rpc:mark_giving_handed_over');
  return snapshotOf(client, row);
}

/** Rates the other member of a handed-over handoff, once (`handoff_already_rated`). */
export async function rateGivingHandoff(
  client: Client,
  handoffId: string,
  rating: number,
  comment?: string | null,
): Promise<void> {
  unwrapCall(
    'rpc:rate_handoff',
    await client.rpc('rate_handoff', { p_handoff_id: handoffId, p_stars: rating, p_comment: comment ?? undefined }),
  );
}
