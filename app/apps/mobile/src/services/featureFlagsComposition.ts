import { getSupabaseClient } from '@kc/infrastructure-supabase';
import type { RemoteFeatureFlags } from '../config/featureFlags';
import { pickAuthStorage } from './authSecureStorage';

/** Reads public.app_flags (0403). Any failure → {} so compiled defaults apply. */
export async function fetchRemoteFeatureFlags(): Promise<RemoteFeatureFlags> {
  try {
    const { data, error } = await getSupabaseClient({ storage: pickAuthStorage() })
      .from('app_flags')
      .select('key, enabled');
    if (error || !data) return {};
    return Object.fromEntries(data.map((row) => [row.key, row.enabled]));
  } catch {
    return {};
  }
}
