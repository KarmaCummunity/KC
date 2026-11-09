import type { KnowledgeBooking, KnowledgeSlot } from '@kc/domain';

/**
 * Seat bookings on knowledge slots (FR-KNOW-004, #2034; RPCs of migration 0702). Authorization
 * and state rules live on the server; every write returns once it was accepted, and the server
 * notifies the other side. Errors keep the server's code in their message (e.g. `slots_exhausted`)
 * so the app maps them to copy. Cancelling a booking is the shared giving-handoff cancel.
 */
export interface IKnowledgeBookingRepository {
  /** Upcoming open slots of a post with their seats left and the viewer's own booking. */
  listSlots(postId: string): Promise<KnowledgeSlot[]>;
  /** Books one seat on a slot; resolves to the new booking id. */
  bookSeat(slotId: string): Promise<string>;
  /** Giver only: every booking of the post. */
  listBookings(postId: string): Promise<KnowledgeBooking[]>;
  /** Giver approves a waiting booking. */
  confirm(handoffId: string): Promise<void>;
  /** Giver declines a waiting booking, freeing its seat. */
  decline(handoffId: string): Promise<void>;
  /** Either side marks the session done (from 15 minutes before it starts); earns karma. */
  completeSession(handoffId: string): Promise<void>;
}
