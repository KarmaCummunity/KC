import {
  getSupabaseClient,
  SupabaseMarketplaceRepository,
} from '@kc/infrastructure-supabase';
import type { IMarketplaceRepository } from '@kc/application';
import { pickAuthStorage } from './authSecureStorage';

let _repo: IMarketplaceRepository | null = null;

export function getMarketplaceSupabaseClient() {
  return getSupabaseClient({ storage: pickAuthStorage() });
}

export function marketplaceRepository(): IMarketplaceRepository {
  if (!_repo) {
    _repo = new SupabaseMarketplaceRepository(getSupabaseClient({ storage: pickAuthStorage() }));
  }
  return _repo;
}
