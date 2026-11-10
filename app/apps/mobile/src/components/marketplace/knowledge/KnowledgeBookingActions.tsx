// Booking section of a knowledge offer screen (FR-KNOW-004, #2034): the giver manages every booking,
// a signed-in learner picks a time and follows their own booking. Only kinds with bookable times take
// bookings — a lesson or consulting hour, and the legacy one-slot course / private lesson (0703 keeps
// their slot as a row); a mentoring offer is arranged in chat. A guest sees nothing until signing in.
import React from 'react';
import { isKnowledgeSlotKind, type MarketplaceListingDetail } from '@kc/domain';
import { useAuthStore } from '../../../store/authStore';
import { KnowledgeBookingsPanel } from './KnowledgeBookingsPanel';
import { KnowledgeSlotPicker } from './KnowledgeSlotPicker';

/** Legacy one-slot kinds that 0703 gave a slot row (no longer offered, still bookable). */
const LEGACY_SLOT_KINDS: readonly string[] = ['course', 'private_lesson'];

/** Whether a knowledge post of this kind is booked by time slot. */
export function isBookableKnowledgeKind(kindSlug: string): boolean {
  return isKnowledgeSlotKind(kindSlug) || LEGACY_SLOT_KINDS.includes(kindSlug);
}

interface Props {
  readonly detail: MarketplaceListingDetail;
}

export function KnowledgeBookingActions({ detail }: Props) {
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  if (detail.worldSlug !== 'knowledge' || detail.direction !== 'give' || !userId) return null;
  if (!isBookableKnowledgeKind(detail.kindSlug)) return null;
  return userId === detail.ownerId ? (
    <KnowledgeBookingsPanel listingId={detail.listingId} cityId={detail.cityId} />
  ) : (
    <KnowledgeSlotPicker listingId={detail.listingId} cityId={detail.cityId} />
  );
}
