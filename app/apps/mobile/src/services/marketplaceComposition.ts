import { getSupabaseClient, SupabaseMarketplaceRepository } from '@kc/infrastructure-supabase';
import type { IMarketplaceRepository } from '@kc/application';
import { pickAuthStorage } from './authSecureStorage';
import { viaApi } from './backend/apiBackend';

let _repo: IMarketplaceRepository | null = null;

/** The shared client (baseline types) the world adapters are built on. */
export function getMarketplaceSupabaseClient() {
  return getSupabaseClient({ storage: pickAuthStorage() });
}

export function marketplaceRepository(): IMarketplaceRepository {
  _repo ??= viaApi('marketplace', new SupabaseMarketplaceRepository(getMarketplaceSupabaseClient()));
  return _repo;
}
