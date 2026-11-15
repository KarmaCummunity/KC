import type { SupabaseClient } from '@supabase/supabase-js';
import { isKnowledgeBookingStatus, type KnowledgeBooking, type KnowledgeSlot } from '@kc/domain';
import type { IKnowledgeBookingRepository } from '@kc/application';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { requireRpcRow } from '../marketplace/rpcRow';
import { sessionUserId } from '../users/userReads';

type Client = SupabaseClient<Database>;
type SlotSeatsRow = Database['public']['Functions']['knowledge_slot_seats']['Returns'][number];
type HandoffRow = Database['public']['Tables']['post_handoffs']['Row'];
type LearnerRow = Pick<Database['public']['Tables']['users']['Row'], 'id' | 'display_name' | 'avatar_url'>;
type SlotRef = { readonly id: string; readonly starts_at: string };
type HandoffRpc = 'confirm_item_handoff' | 'cancel_giving_handoff' | 'mark_giving_handed_over';

/** A booking is tied to its slot by its start: slots of one post never overlap (70_worlds/150). */
const sameInstant = (a: string | null, b: string): boolean => a !== null && Date.parse(a) === Date.parse(b);

/**
 * Knowledge seat bookings on the baseline (FR-KNOW-004): slots are `post_knowledge_slots` rows,
 * read with their places left through `knowledge_slot_seats`; a booking is an ordinary handoff of
 * the giving machine, booked with `book_knowledge_seat` and moved by the generic handoff RPCs (the
 * giver confirms with `confirm_item_handoff`, declines with `cancel_giving_handoff`, completes
 * with `mark_giving_handed_over`). A refusal is a `BackendRuleError` with the server's reason.
 */
export class SupabaseKnowledgeBookingRepository implements IKnowledgeBookingRepository {
  constructor(private readonly client: Client) {}

  async listSlots(postId: string): Promise<KnowledgeSlot[]> {
    const [slots, me] = await Promise.all([
      this.client.rpc('knowledge_slot_seats', { p_post_id: postId }),
      sessionUserId(this.client),
    ]);
    const rows = unwrapCall('rpc:knowledge_slot_seats', slots) ?? [];
    const mine = me && rows.length > 0 ? await this.myHandoffs(postId, me) : [];
    return rows.map((row) => mapSlotRow(row, mine.find((h) => sameInstant(h.slot_starts_at, row.starts_at)) ?? null));
  }

  async bookSeat(slotId: string): Promise<string> {
    const row = unwrapCall('rpc:book_knowledge_seat', await this.client.rpc('book_knowledge_seat', { p_slot_id: slotId }));
    return requireRpcRow(row, 'book_knowledge_seat').id;
  }

  /** The giver's view: every booking of the post with the learner's name. */
  async listBookings(postId: string): Promise<KnowledgeBooking[]> {
    const handoffs =
      unwrapCall(
        'table:post_handoffs',
        await this.client.from('post_handoffs').select('*').eq('post_id', postId).order('created_at', { ascending: true }),
      ) ?? [];
    if (handoffs.length === 0) return [];
    const [slots, learners] = await Promise.all([
      this.client.from('post_knowledge_slots').select('id, starts_at').eq('post_id', postId),
      this.client.from('users').select('id, display_name, avatar_url').in('id', [...new Set(handoffs.map((h) => h.recipient_id))]),
    ]);
    const slotRefs = unwrapCall('table:post_knowledge_slots', slots) ?? [];
    const learnerById = new Map((unwrapCall('table:users', learners) ?? []).map((u) => [u.id, u]));
    return handoffs.flatMap((h) => {
      const booking = mapBookingRow(h, slotRefs, learnerById.get(h.recipient_id) ?? null);
      return booking ? [booking] : [];
    });
  }

  confirm(handoffId: string): Promise<void> {
    return this.move('confirm_item_handoff', handoffId);
  }

  decline(handoffId: string): Promise<void> {
    return this.move('cancel_giving_handoff', handoffId);
  }

  completeSession(handoffId: string): Promise<void> {
    return this.move('mark_giving_handed_over', handoffId);
  }

  /** The caller's handoffs on the post, newest first, so the first match per slot is the latest. */
  private async myHandoffs(postId: string, me: string): Promise<HandoffRow[]> {
    return (
      unwrapCall(
        'table:post_handoffs',
        await this.client
          .from('post_handoffs')
          .select('*')
          .eq('post_id', postId)
          .eq('recipient_id', me)
          .order('created_at', { ascending: false }),
      ) ?? []
    );
  }

  private async move(rpc: HandoffRpc, handoffId: string): Promise<void> {
    unwrapCall(`rpc:${rpc}`, await this.client.rpc(rpc, { p_handoff_id: handoffId }));
  }
}

/** One slot with the viewer's own latest booking on it. */
export function mapSlotRow(row: SlotSeatsRow, mine: HandoffRow | null): KnowledgeSlot {
  return {
    slotId: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    capacity: row.capacity,
    seatsLeft: Math.max(0, row.seats_left),
    myHandoffId: mine?.id ?? null,
    myStatus: isKnowledgeBookingStatus(mine?.status) ? mine.status : null,
  };
}

/** One booking for the giver, or null when its status is unknown to this client. */
export function mapBookingRow(row: HandoffRow, slots: readonly SlotRef[], learner: LearnerRow | null): KnowledgeBooking | null {
  if (!isKnowledgeBookingStatus(row.status)) return null;
  return {
    handoffId: row.id,
    slotId: slots.find((slot) => sameInstant(row.slot_starts_at, slot.starts_at))?.id ?? null,
    startsAt: row.slot_starts_at,
    endsAt: row.slot_ends_at,
    status: row.status,
    cancelReason: row.cancel_reason,
    confirmBy: row.confirm_by,
    learnerId: row.recipient_id,
    learnerName: learner?.display_name ?? '',
    learnerAvatarUrl: learner?.avatar_url ?? null,
  };
}
