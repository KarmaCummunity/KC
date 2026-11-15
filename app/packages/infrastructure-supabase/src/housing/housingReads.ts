// The housing booking lists on the baseline (FR-HOUSING-036 my hosting, FR-HOUSING-037 my stays).
//
// A booking is a `post_handoffs` row (machine `housing_booking`) plus its `handoff_booking_details`
// row; both are readable by the host and the guest only. The other side's name comes from `users`,
// the guest's completed stays from `housing_completed_stays` (trust block, S16), and "rated by me"
// from `post_ratings`, which shows a member only the ratings they wrote.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { HousingGuestStay, HousingHostBooking } from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { sessionUserId } from '../users/userReads';
import {
  mapGuestStay,
  mapHostBooking,
  type BookingDetailsRow,
  type HandoffRow,
} from './housingMappers';

type Client = SupabaseClient<Database>;

const MACHINE = 'housing_booking';
/** Bookings a host still manages or may rate on an offer (cancelled ones leave the panel). */
const HOST_STATUSES = ['reserved', 'confirmed', 'handed_over'];
const DEFAULT_STAYS_LIMIT = 50;

const unique = (ids: readonly string[]): string[] => [...new Set(ids)];

/** The booking details of the handoffs, by handoff id. */
async function detailsOf(client: Client, handoffIds: readonly string[]): Promise<Map<string, BookingDetailsRow>> {
  const rows = unwrapCall(
    'table:handoff_booking_details',
    await client.from('handoff_booking_details').select('*').in('handoff_id', [...handoffIds]),
  );
  return new Map((rows ?? []).map((row) => [row.handoff_id, row]));
}

/** The handoffs among `handoffIds` the caller rated. */
async function ratedOf(client: Client, handoffIds: readonly string[]): Promise<Set<string>> {
  const rows = unwrapCall(
    'table:post_ratings',
    await client.from('post_ratings').select('handoff_id').in('handoff_id', [...handoffIds]),
  );
  return new Set((rows ?? []).flatMap((row) => (row.handoff_id ? [row.handoff_id] : [])));
}

/** Completed stays per member, for the members whose profile the caller can read. */
async function completedStaysOf(client: Client, userIds: readonly string[]): Promise<Map<string, number>> {
  const rows = unwrapCall(
    'rpc:housing_completed_stays',
    await client.rpc('housing_completed_stays', { p_user_ids: [...userIds] }),
  );
  return new Map((rows ?? []).map((row) => [row.user_id, row.completed_stays]));
}

/** Waiting requests first, then by check-in day, then by request time (the host's work order). */
function hostOrder(a: HousingHostBooking, b: HousingHostBooking): number {
  const waiting = Number(b.status === 'reserved') - Number(a.status === 'reserved');
  if (waiting !== 0) return waiting;
  return a.checkInDate.localeCompare(b.checkInDate) || a.reservedAt.localeCompare(b.reservedAt);
}

/** Every live booking on one stay offer, for its host. */
export async function listHostBookings(client: Client, postId: string): Promise<HousingHostBooking[]> {
  const handoffs: HandoffRow[] =
    unwrapCall(
      'table:post_handoffs',
      await client.from('post_handoffs').select('*').eq('post_id', postId).eq('machine_id', MACHINE).in('status', HOST_STATUSES),
    ) ?? [];
  if (handoffs.length === 0) return [];
  const ids = handoffs.map((h) => h.id);
  const guestIds = unique(handoffs.map((h) => h.recipient_id));
  const [details, rated, stays, guests] = await Promise.all([
    detailsOf(client, ids),
    ratedOf(client, ids),
    completedStaysOf(client, guestIds),
    client.from('users').select('id, display_name, avatar_url, verification_level, created_at').in('id', guestIds),
  ]);
  const guestById = new Map((unwrapCall('table:users', guests) ?? []).map((u) => [u.id, u]));
  return handoffs
    .flatMap((h) => {
      const row = details.get(h.id);
      const booking = row
        ? mapHostBooking(h, row, guestById.get(h.recipient_id) ?? null, stays.get(h.recipient_id) ?? 0, rated.has(h.id))
        : null;
      return booking ? [booking] : [];
    })
    .sort(hostOrder);
}

/** The caller's own stay bookings, newest first. */
export async function listGuestStays(client: Client, limit = DEFAULT_STAYS_LIMIT): Promise<HousingGuestStay[]> {
  const me = await sessionUserId(client);
  if (!me) return [];
  const handoffs: HandoffRow[] =
    unwrapCall(
      'table:post_handoffs',
      await client
        .from('post_handoffs')
        .select('*')
        .eq('recipient_id', me)
        .eq('machine_id', MACHINE)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit),
    ) ?? [];
  if (handoffs.length === 0) return [];
  const ids = handoffs.map((h) => h.id);
  const [details, rated, posts, hosts] = await Promise.all([
    detailsOf(client, ids),
    ratedOf(client, ids),
    client.from('posts').select('id, title, city_id').in('id', unique(handoffs.map((h) => h.post_id))),
    client.from('users').select('id, display_name').in('id', unique(handoffs.map((h) => h.owner_id))),
  ]);
  const postById = new Map((unwrapCall('table:posts', posts) ?? []).map((p) => [p.id, p]));
  const hostById = new Map((unwrapCall('table:users', hosts) ?? []).map((u) => [u.id, u.display_name]));
  const now = new Date();
  return handoffs.flatMap((h) => {
    const row = details.get(h.id);
    const stay = row
      ? mapGuestStay(h, row, postById.get(h.post_id) ?? null, hostById.get(h.owner_id) ?? null, rated.has(h.id), now)
      : null;
    return stay ? [stay] : [];
  });
}
