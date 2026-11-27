// Composition root for knowledge slot bookings (FR-KNOW-004; supabase/schemas/70_worlds/150, 200).
import {
  BookKnowledgeSeatUseCase,
  CompleteKnowledgeSessionUseCase,
  ConfirmKnowledgeBookingUseCase,
  DeclineKnowledgeBookingUseCase,
  ListKnowledgeBookingsUseCase,
  ListKnowledgeSlotsUseCase,
  GetKnowledgeSlotSeriesUseCase,
  SetKnowledgeSlotSeriesStatusUseCase,
  type IKnowledgeBookingRepository,
  type IKnowledgeSlotSeriesRepository,
} from '@kc/application';
import { SupabaseKnowledgeBookingRepository, SupabaseKnowledgeSlotSeriesRepository } from '@kc/infrastructure-supabase';
import { container, supabase } from '../lib/container';
import { viaApi } from './backend/apiBackend';

let repo: IKnowledgeBookingRepository | null = null;
let seriesRepo: IKnowledgeSlotSeriesRepository | null = null;

/** One adapter per app session, created on first use (after auth storage is ready). */
function repository(): IKnowledgeBookingRepository {
  repo ??= viaApi('knowledgeBooking', new SupabaseKnowledgeBookingRepository(supabase));
  return repo;
}

function seriesRepository(): IKnowledgeSlotSeriesRepository {
  seriesRepo ??= viaApi('knowledgeSlotSeries', new SupabaseKnowledgeSlotSeriesRepository(supabase));
  return seriesRepo;
}

/** The weekly series of a recurring lesson offer (FR-KNOW-004 AC1, #2479). */
export const knowledgeSeriesUseCases = {
  get: () => new GetKnowledgeSlotSeriesUseCase(seriesRepository()),
  setStatus: () => new SetKnowledgeSlotSeriesStatusUseCase(seriesRepository()),
};

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
/** React Query key of a lesson offer's weekly series (null when its times are one-off). */
export const knowledgeSeriesQueryKey = (listingId: string) => ['knowledge-series', listingId] as const;
/** React Query key of a post's bookings (giver view). */
export const knowledgeBookingsQueryKey = (listingId: string) => ['knowledge-bookings', listingId] as const;

/** Locates or creates the one chat between the giver and a learner (D13), to settle the details. */
export async function openKnowledgeLearnerChat(viewerId: string, learnerId: string): Promise<string> {
  const chat = await container.openOrCreateChat.execute({ viewerId, otherUserId: learnerId });
  return chat.chatId;
}
