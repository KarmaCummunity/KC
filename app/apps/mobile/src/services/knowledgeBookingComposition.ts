// Composition root for knowledge slot bookings (FR-KNOW-004, #2034; RPCs of migration 0704).
import {
  BookKnowledgeSeatUseCase,
  CompleteKnowledgeSessionUseCase,
  ConfirmKnowledgeBookingUseCase,
  DeclineKnowledgeBookingUseCase,
  ListKnowledgeBookingsUseCase,
  ListKnowledgeSlotsUseCase,
  type IKnowledgeBookingRepository,
} from '@kc/application';
import { SupabaseKnowledgeBookingRepository } from '@kc/infrastructure-supabase';
import { container } from '../lib/container';
import { getMarketplaceSupabaseClient } from './marketplaceComposition';

let repo: IKnowledgeBookingRepository | null = null;

/** One adapter per app session, created on first use (after auth storage is ready). */
function repository(): IKnowledgeBookingRepository {
  repo ??= new SupabaseKnowledgeBookingRepository(getMarketplaceSupabaseClient());
  return repo;
}

export const knowledgeBookingUseCases = {
  listSlots: () => new ListKnowledgeSlotsUseCase(repository()),
  book: () => new BookKnowledgeSeatUseCase(repository()),
  listBookings: () => new ListKnowledgeBookingsUseCase(repository()),
  confirm: () => new ConfirmKnowledgeBookingUseCase(repository()),
  decline: () => new DeclineKnowledgeBookingUseCase(repository()),
  complete: () => new CompleteKnowledgeSessionUseCase(repository()),
};

/** React Query key of a post's slots as the viewer sees them (learner view). */
export const knowledgeSlotsQueryKey = (listingId: string) => ['knowledge-slots', listingId] as const;
/** React Query key of a post's bookings (giver view). */
export const knowledgeBookingsQueryKey = (listingId: string) => ['knowledge-bookings', listingId] as const;

/** Locates or creates the one chat between the giver and a learner (D13), to settle the details. */
export async function openKnowledgeLearnerChat(viewerId: string, learnerId: string): Promise<string> {
  const chat = await container.openOrCreateChat.execute({ viewerId, otherUserId: learnerId });
  return chat.chatId;
}
