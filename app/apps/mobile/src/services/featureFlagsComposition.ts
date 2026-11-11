import { getSupabaseClient } from '@kc/infrastructure-supabase';
import type { RemoteFeatureFlags } from '../config/featureFlags';
import { pickAuthStorage } from './authSecureStorage';

/**
 * Reads public.app_flags as the signed-in member. A failed read throws: returning `{}` made a
 * failure look like "no flags set", which the query cache then kept as fresh data and which turned
 * every launch world into its compiled default. The caller treats an error as "not loaded".
 */
export async function fetchRemoteFeatureFlags(): Promise<RemoteFeatureFlags> {
  const { data, error } = await getSupabaseClient({ storage: pickAuthStorage() })
    .from('app_flags')
    .select('key, enabled');
  if (error) throw new Error(`app_flags read failed: ${error.message}`);
  return Object.fromEntries((data ?? []).map((row) => [row.key, row.enabled]));
}
