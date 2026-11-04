// FR-ADMIN-031 — lazily built demo-data admin repository over the shared (auth-aware) Supabase client.
import { SupabaseDemoDataRepository } from '@kc/infrastructure-supabase';
import { getMarketplaceSupabaseClient } from './marketplaceComposition';

let _repo: SupabaseDemoDataRepository | null = null;

export function getDemoDataRepository(): SupabaseDemoDataRepository {
  _repo ??= new SupabaseDemoDataRepository(getMarketplaceSupabaseClient());
  return _repo;
}
