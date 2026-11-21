import type { IProEntitlementRepository } from '@kc/application';
import { SupabaseProEntitlementRepository } from '@kc/infrastructure-supabase';
import { viaApi } from './backend/apiBackend';
import { getMarketplaceSupabaseClient } from './marketplaceComposition';

let repository: IProEntitlementRepository | null = null;

/** The signed-in member's Pro entitlement, as the server records it. */
export function getProEntitlementRepository(): IProEntitlementRepository {
  repository ??= viaApi('proEntitlement', new SupabaseProEntitlementRepository(getMarketplaceSupabaseClient()));
  return repository;
}
