// Composition root for housing stays (docs/spec/requirements/21_housing.md FR-HOUSING-003, 012, 015–022).
import {
  AcceptHousingConductUseCase,
  CancelHousingBookingUseCase,
  CompleteHousingStayUseCase,
  DecideHousingBookingUseCase,
  GetHousingConductStatusUseCase,
  GetHousingPrivateDetailsUseCase,
  ListHousingOfferBookingsUseCase,
  ListMyHousingStaysUseCase,
  MarkHousingNoShowUseCase,
  RequestHousingStayUseCase,
  SetHousingPrivateDetailsUseCase,
  type IHousingRepository,
} from '@kc/application';
import { SupabaseHousingRepository } from '@kc/infrastructure-supabase';
import { container, legacySupabase } from '../lib/container';

let repo: IHousingRepository | null = null;

/** One adapter per app session, created on first use (after auth storage is ready). */
function repository(): IHousingRepository {
  repo ??= new SupabaseHousingRepository(legacySupabase);
  return repo;
}

export const housingUseCases = {
  conductStatus: () => new GetHousingConductStatusUseCase(repository()),
  acceptConduct: () => new AcceptHousingConductUseCase(repository()),
  requestStay: () => new RequestHousingStayUseCase(repository()),
  decide: () => new DecideHousingBookingUseCase(repository()),
  cancel: () => new CancelHousingBookingUseCase(repository()),
  complete: () => new CompleteHousingStayUseCase(repository()),
  markNoShow: () => new MarkHousingNoShowUseCase(repository()),
  listForOffer: () => new ListHousingOfferBookingsUseCase(repository()),
  listMyStays: () => new ListMyHousingStaysUseCase(repository()),
  privateDetails: () => new GetHousingPrivateDetailsUseCase(repository()),
  setPrivateDetails: () => new SetHousingPrivateDetailsUseCase(repository()),
};

/** Locates or creates the direct chat between a host and a guest (one chat per pair, D13). */
export async function openHousingChat(viewerId: string, otherUserId: string): Promise<string> {
  const chat = await container.openOrCreateChat.execute({ viewerId, otherUserId });
  return chat.chatId;
}

/** React Query keys of the housing views. */
export const housingQueryKeys = {
  offerBookings: (listingId: string) => ['housing-offer-bookings', listingId] as const,
  myStays: ['housing-my-stays'] as const,
  privateDetails: (listingId: string) => ['housing-private-details', listingId] as const,
  conduct: ['housing-conduct'] as const,
};
