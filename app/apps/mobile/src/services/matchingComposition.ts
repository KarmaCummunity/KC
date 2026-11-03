// Matching v2 — lazily built repository over the shared (auth-aware) Supabase client.
import { SupabaseMatchRepository } from '@kc/infrastructure-supabase';
import { getMarketplaceSupabaseClient } from './marketplaceComposition';

let _repo: SupabaseMatchRepository | null = null;

export function getMatchRepository(): SupabaseMatchRepository {
  _repo ??= new SupabaseMatchRepository(getMarketplaceSupabaseClient());
  return _repo;
}
