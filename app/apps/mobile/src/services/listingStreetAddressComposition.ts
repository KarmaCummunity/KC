// Composition root for the street address of a listing that happens at a place (an event).
import {
  GetOwnListingStreetAddressUseCase,
  SaveListingStreetAddressUseCase,
  type IListingStreetAddressRepository,
} from '@kc/application';
import { SupabaseListingStreetAddressRepository } from '@kc/infrastructure-supabase';
import { getMarketplaceSupabaseClient } from './marketplaceComposition';
import { viaApi } from './backend/apiBackend';

let repo: IListingStreetAddressRepository | null = null;

function repository(): IListingStreetAddressRepository {
  repo ??= viaApi('listingStreetAddress', new SupabaseListingStreetAddressRepository(getMarketplaceSupabaseClient()));
  return repo;
}

export const listingStreetAddressUseCases = {
  save: () => new SaveListingStreetAddressUseCase(repository()),
  getOwn: () => new GetOwnListingStreetAddressUseCase(repository()),
};

export const listingStreetAddressQueryKey = (listingId: string) => ['listing-street-address', listingId] as const;
