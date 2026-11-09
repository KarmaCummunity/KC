// FR-KNOW-003 / FR-KNOW-004 (docs/spec/requirements/23_knowledge.md, #2034) — knowledge exchange
// kinds, bookable slots and seat bookings. The server (migrations 0700–0701) is the authority;
// these pure rules mirror it so the create form and the booking screens can explain a problem
// before the round trip, with the same error codes the server raises.

/** The six exchange kinds of the knowledge world (`listing_kinds.slug`), in display order. */
export const KNOWLEDGE_POST_KIND_SLUGS = [
  'lesson_offer',
  'mentoring_offer',
  'consulting_hour',
  'learning_request',
  'mentoring_request',
  'question',
] as const;
export type KnowledgePostKindSlug = (typeof KNOWLEDGE_POST_KIND_SLUGS)[number];

/** Kinds whose details carry bookable slots (`details.slots`). */
export const KNOWLEDGE_SLOT_KIND_SLUGS = ['lesson_offer', 'consulting_hour'] as const;
export type KnowledgeSlotKindSlug = (typeof KNOWLEDGE_SLOT_KIND_SLUGS)[number];

export function isKnowledgeSlotKind(slug: string | null | undefined): slug is KnowledgeSlotKindSlug {
  return slug != null && (KNOWLEDGE_SLOT_KIND_SLUGS as readonly string[]).includes(slug);
}

/** Limits mirrored from `knowledge_check_slots` (0700). */
export const KNOWLEDGE_SLOTS_MAX = 20;
export const KNOWLEDGE_SLOT_MIN_MINUTES = 15;
export const KNOWLEDGE_SLOT_MAX_MINUTES = 8 * 60;
/** A session can be marked done from 15 minutes before it starts (`complete_knowledge_session`). */
export const KNOWLEDGE_SESSION_COMPLETE_LEAD_MINUTES = 15;

/** One bookable time as the owner edits it: ISO date-times. */
export interface KnowledgeSlotWindow {
  readonly startsAt: string;
  readonly endsAt: string;
}

/** The server's slot error codes (0700), reused as the client's. */
export type KnowledgeSlotProblem =
  | 'knowledge_slot_invalid'
  | 'knowledge_slot_duration_invalid'
  | 'knowledge_slot_in_past'
  | 'knowledge_slots_overlap';

const MINUTE_MS = 60_000;

/**
 * The first problem of a slot list, or null when the server would accept it as a new post's
 * slots: 1–20 slots, each a valid window of 15 minutes to 8 hours that starts after `now`, none
 * overlapping another. Mirrors `knowledge_check_slots`, which additionally lets an existing slot
 * stay after it passed.
 */
export function knowledgeSlotsProblem(
  slots: readonly KnowledgeSlotWindow[],
  now: Date = new Date(),
): KnowledgeSlotProblem | null {
  if (slots.length < 1 || slots.length > KNOWLEDGE_SLOTS_MAX) return 'knowledge_slot_invalid';
  const windows = slots.map((s) => ({ start: Date.parse(s.startsAt), end: Date.parse(s.endsAt) }));
  if (windows.some((w) => Number.isNaN(w.start) || Number.isNaN(w.end) || w.end <= w.start)) {
    return 'knowledge_slot_invalid';
  }
  const tooShortOrLong = windows.some((w) => {
    const minutes = (w.end - w.start) / MINUTE_MS;
    return minutes < KNOWLEDGE_SLOT_MIN_MINUTES || minutes > KNOWLEDGE_SLOT_MAX_MINUTES;
  });
  if (tooShortOrLong) return 'knowledge_slot_duration_invalid';
  if (windows.some((w) => w.start <= now.getTime())) return 'knowledge_slot_in_past';
  const sorted = [...windows].sort((a, b) => a.start - b.start);
  // Sorted by start, a slot overlaps when it starts before the previous one ends.
  if (sorted.some((w, i) => i > 0 && w.start < sorted[i - 1]!.end)) return 'knowledge_slots_overlap';
  return null;
}

/**
 * The slots stored in a post's details (`details.slots: [{starts_at, ends_at}]`), or null when the
 * details hold no slot list (a kind without slots, or a legacy one-slot post).
 */
export function knowledgeSlotsFromDetails(details: Readonly<Record<string, unknown>>): KnowledgeSlotWindow[] | null {
  const raw = details.slots;
  if (!Array.isArray(raw)) return null;
  return raw.map((item) => {
    const slot = (item ?? {}) as { starts_at?: unknown; ends_at?: unknown };
    return {
      startsAt: typeof slot.starts_at === 'string' ? slot.starts_at : '',
      endsAt: typeof slot.ends_at === 'string' ? slot.ends_at : '',
    };
  });
}

/** The details shape of a slot list, sorted by start (what the server stores and matches by). */
export function knowledgeSlotsToDetails(
  slots: readonly KnowledgeSlotWindow[],
): Array<{ starts_at: string; ends_at: string }> {
  return [...slots]
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .map((s) => ({ starts_at: s.startsAt, ends_at: s.endsAt }));
}

/** A bookable slot as a learner sees it (`list_knowledge_slots`). */
export interface KnowledgeSlot {
  readonly slotId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly capacity: number;
  readonly seatsLeft: number;
  /** The viewer's own latest booking on this slot, if any. */
  readonly myHandoffId: string | null;
  readonly myStatus: KnowledgeBookingStatus | null;
}

/** Booking states on the `giving_handoff` machine (0694) that a knowledge booking passes through. */
export const KNOWLEDGE_BOOKING_STATUSES = ['reserved', 'confirmed', 'handed_over', 'cancelled', 'no_show'] as const;
export type KnowledgeBookingStatus = (typeof KNOWLEDGE_BOOKING_STATUSES)[number];

export function isKnowledgeBookingStatus(value: string | null | undefined): value is KnowledgeBookingStatus {
  return value != null && (KNOWLEDGE_BOOKING_STATUSES as readonly string[]).includes(value);
}

/** A booking of a knowledge post as its giver sees it (`list_knowledge_bookings`). */
export interface KnowledgeBooking {
  readonly handoffId: string;
  readonly slotId: string | null;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly status: KnowledgeBookingStatus;
  /** Why a cancelled booking ended: declined, expired, or which side cancelled. */
  readonly cancelReason: string | null;
  /** The giver answers before this time, or the booking expires. */
  readonly confirmBy: string | null;
  readonly learnerId: string;
  readonly learnerName: string;
  readonly learnerAvatarUrl: string | null;
}

/** Whether a slot still takes a booking from the viewer: open seats, not started, not booked. */
export function canBookKnowledgeSlot(slot: KnowledgeSlot, now: Date = new Date()): boolean {
  const booked = slot.myStatus === 'reserved' || slot.myStatus === 'confirmed';
  return !booked && slot.seatsLeft > 0 && Date.parse(slot.startsAt) > now.getTime();
}

/** Whether either side may mark the session done: still active and starting within 15 minutes. */
export function canCompleteKnowledgeSession(
  booking: Pick<KnowledgeBooking, 'status' | 'startsAt'>,
  now: Date = new Date(),
): boolean {
  if (booking.status !== 'reserved' && booking.status !== 'confirmed') return false;
  if (!booking.startsAt) return true;
  return Date.parse(booking.startsAt) <= now.getTime() + KNOWLEDGE_SESSION_COMPLETE_LEAD_MINUTES * MINUTE_MS;
}
