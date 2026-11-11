import { getSupabaseClient, SupabaseMarketplaceRepository } from '@kc/infrastructure-supabase';
import type { IMarketplaceRepository } from '@kc/application';
import { pickAuthStorage } from './authSecureStorage';

let _repo: IMarketplaceRepository | null = null;

/** The shared client (baseline types) the world adapters are built on. */
export function getMarketplaceSupabaseClient() {
  return getSupabaseClient({ storage: pickAuthStorage() });
}

export function marketplaceRepository(): IMarketplaceRepository {
  _repo ??= new SupabaseMarketplaceRepository(getMarketplaceSupabaseClient());
  return _repo;
}
