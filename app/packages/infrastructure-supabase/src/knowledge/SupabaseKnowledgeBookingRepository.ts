import type { SupabaseClient } from '@supabase/supabase-js';
import { isKnowledgeBookingStatus, type KnowledgeBooking, type KnowledgeSlot } from '@kc/domain';
import type { IKnowledgeBookingRepository } from '@kc/application';
import type { Database } from '../database.types';

type Client = SupabaseClient<Database>;
type SlotRow = Database['public']['Functions']['list_knowledge_slots']['Returns'][number];
type BookingRow = Database['public']['Functions']['list_knowledge_bookings']['Returns'][number];
type HandoffRpc = 'confirm_knowledge_booking' | 'decline_knowledge_booking' | 'complete_knowledge_session';

/**
 * Knowledge seat bookings over the 0702 RPCs (FR-KNOW-004, #2034). Server errors keep their
 * message (an error code such as `slots_exhausted`) so the app maps it to copy; the server queues
 * the push to the other side on every change.
 */
export class SupabaseKnowledgeBookingRepository implements IKnowledgeBookingRepository {
  constructor(private readonly client: Client) {}

  async listSlots(postId: string): Promise<KnowledgeSlot[]> {
    const { data, error } = await this.client.rpc('list_knowledge_slots', { p_post_id: postId });
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapSlotRow);
  }

  async bookSeat(slotId: string): Promise<string> {
    const { data, error } = await this.client.rpc('book_knowledge_seat', { p_slot_id: slotId });
    if (error) throw new Error(error.message);
    if (!data?.handoff_id) throw new Error('handoff_not_found');
    return data.handoff_id;
  }

  async listBookings(postId: string): Promise<KnowledgeBooking[]> {
    const { data, error } = await this.client.rpc('list_knowledge_bookings', { p_post_id: postId });
    if (error) throw new Error(error.message);
    // A row with a status this client does not know is left out rather than mislabeled.
    return (data ?? []).flatMap((row) => {
      const booking = mapBookingRow(row);
      return booking ? [booking] : [];
    });
  }

  confirm(handoffId: string): Promise<void> {
    return this.runHandoffRpc('confirm_knowledge_booking', handoffId);
  }

  decline(handoffId: string): Promise<void> {
    return this.runHandoffRpc('decline_knowledge_booking', handoffId);
  }

  completeSession(handoffId: string): Promise<void> {
    return this.runHandoffRpc('complete_knowledge_session', handoffId);
  }

  private async runHandoffRpc(rpc: HandoffRpc, handoffId: string): Promise<void> {
    const { error } = await this.client.rpc(rpc, { p_handoff_id: handoffId });
    if (error) throw new Error(error.message);
  }
}

/** One row of `list_knowledge_slots`. */
export function mapSlotRow(row: SlotRow): KnowledgeSlot {
  return {
    slotId: row.slot_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    capacity: row.capacity,
    seatsLeft: Math.max(0, row.seats_left),
    myHandoffId: row.my_handoff_id ?? null,
    myStatus: isKnowledgeBookingStatus(row.my_status) ? row.my_status : null,
  };
}

/** One row of `list_knowledge_bookings`, or null when its status is unknown to this client. */
export function mapBookingRow(row: BookingRow): KnowledgeBooking | null {
  if (!isKnowledgeBookingStatus(row.status)) return null;
  return {
    handoffId: row.handoff_id,
    slotId: row.slot_id ?? null,
    startsAt: row.starts_at ?? null,
    endsAt: row.ends_at ?? null,
    status: row.status,
    cancelReason: row.cancel_reason ?? null,
    confirmBy: row.confirm_by ?? null,
    learnerId: row.learner_id,
    learnerName: row.learner_name ?? '',
    learnerAvatarUrl: row.learner_avatar ?? null,
  };
}
