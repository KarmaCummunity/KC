import type { IFeatureFlagsRepository } from '@kc/application';
import { getSupabaseClient, SupabaseFeatureFlagsRepository } from '@kc/infrastructure-supabase';
import type { RemoteFeatureFlags } from '../config/featureFlags';
import { pickAuthStorage } from './authSecureStorage';
import { viaApi } from './backend/apiBackend';

let repository: IFeatureFlagsRepository | null = null;
function featureFlagsRepository(): IFeatureFlagsRepository {
  repository ??= viaApi('featureFlags', new SupabaseFeatureFlagsRepository(getSupabaseClient({ storage: pickAuthStorage() })));
  return repository;
}

/**
 * Reads public.app_flags as the signed-in member. A failed read throws: returning `{}` made a
 * failure look like "no flags set", which the query cache then kept as fresh data and which turned
 * every launch world into its compiled default. The caller treats an error as "not loaded".
 */
export function fetchRemoteFeatureFlags(): Promise<RemoteFeatureFlags> {
  return featureFlagsRepository().listFlags();
}
