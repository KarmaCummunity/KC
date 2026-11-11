import type { SupabaseClient } from '@supabase/supabase-js';
import type { GivingHandoffSnapshot, MyGivingHandoffRow } from '@kc/domain';
import type { Database } from '../database.legacy.types';

// Items/food handoff RPCs, split out of SupabaseMarketplaceRepository to keep
// that file under the 300-line architecture cap.
type Client = SupabaseClient<Database>;
type HandoffRow = Database['public']['Views']['giving_handoffs']['Row'];

export function mapHandoffRow(row: HandoffRow): GivingHandoffSnapshot {
  return {
    handoffId: row.handoff_id ?? '',
    listingId: row.listing_id ?? '',
    ownerId: row.owner_id ?? '',
    recipientId: row.recipient_id ?? '',
    worldSlug: row.world_slug ?? '',
    status: row.status ?? '',
    pickupMode: row.pickup_mode ?? 'pickup',
    pickupWindowStart: row.pickup_window_start,
    pickupWindowEnd: row.pickup_window_end,
    confirmBy: row.confirm_by,
    reservedAt: row.reserved_at ?? '',
    confirmedAt: row.confirmed_at,
  };
}

export function parseHandoffJson(data: unknown): GivingHandoffSnapshot | null {
  if (data == null || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  const optStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  return {
    handoffId: String(o.handoff_id),
    listingId: String(o.listing_id),
    ownerId: String(o.owner_id),
    recipientId: String(o.recipient_id),
    worldSlug: String(o.world_slug),
    status: String(o.status),
    pickupMode: String(o.pickup_mode),
    pickupWindowStart: optStr(o.pickup_window_start),
    pickupWindowEnd: optStr(o.pickup_window_end),
    confirmBy: optStr(o.confirm_by),
    reservedAt: String(o.reserved_at),
    confirmedAt: optStr(o.confirmed_at),
  };
}

export async function getListingHandoff(client: Client, listingId: string) {
  const { data, error } = await client.rpc('get_listing_handoff', { p_listing_id: listingId });
  if (error) return null;
  return parseHandoffJson(data);
}

export async function listMyGivingHandoffs(client: Client, limit = 50): Promise<MyGivingHandoffRow[]> {
  const { data, error } = await client.rpc('list_my_giving_handoffs', { p_limit: limit });
  if (error || !data) return [];
  return data.map((r) => ({
    handoffId: r.handoff_id,
    listingId: r.listing_id,
    title: r.title,
    worldSlug: r.world_slug,
    status: r.status,
    role: r.role as 'owner' | 'recipient',
    pickupWindowStart: r.pickup_window_start,
    pickupWindowEnd: r.pickup_window_end,
    reservedAt: r.reserved_at,
  }));
}

export async function reserveItemGiving(
  client: Client,
  listingId: string,
  pickupMode: 'pickup' | 'delivery' = 'pickup',
  pickupWindowStart?: string | null,
  pickupWindowEnd?: string | null,
) {
  const { data, error } = await client.rpc('reserve_item_giving', {
    p_listing_id: listingId,
    p_pickup_mode: pickupMode,
    p_pickup_window_start: pickupWindowStart ?? undefined,
    p_pickup_window_end: pickupWindowEnd ?? undefined,
  });
  if (error || !data) throw error ?? new Error('reserve_item_giving failed');
  return mapHandoffRow(data);
}

export async function confirmItemHandoff(client: Client, handoffId: string) {
  const { data, error } = await client.rpc('confirm_item_handoff', { p_handoff_id: handoffId });
  if (error || !data) throw error ?? new Error('confirm_item_handoff failed');
  return mapHandoffRow(data);
}

export async function claimFoodGiving(
  client: Client,
  listingId: string,
  pickupWindowStart?: string | null,
  pickupWindowEnd?: string | null,
) {
  const { data, error } = await client.rpc('claim_food_giving', {
    p_listing_id: listingId,
    p_pickup_window_start: pickupWindowStart ?? undefined,
    p_pickup_window_end: pickupWindowEnd ?? undefined,
  });
  if (error || !data) throw error ?? new Error('claim_food_giving failed');
  return mapHandoffRow(data);
}

export async function cancelGivingHandoff(client: Client, handoffId: string) {
  const { error } = await client.rpc('cancel_giving_handoff', { p_handoff_id: handoffId });
  if (error) throw error;
}

export async function markGivingHandedOver(client: Client, handoffId: string) {
  const { data, error } = await client.rpc('mark_giving_handed_over', { p_handoff_id: handoffId });
  if (error || !data) throw error ?? new Error('mark_giving_handed_over failed');
  return mapHandoffRow(data);
}

export async function rateGivingHandoff(client: Client, handoffId: string, rating: number, comment?: string | null) {
  const { error } = await client.rpc('rate_giving_handoff', {
    p_handoff_id: handoffId,
    p_rating: rating,
    p_comment: comment ?? undefined,
  });
  if (error) throw error;
}
