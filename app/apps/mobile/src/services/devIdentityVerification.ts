// FR-VERIFY-010 stub — dev-only mock ID verification until the provider ships (IDV-1).
import type { SupabaseClient } from '@supabase/supabase-js';
import { getMarketplaceSupabaseClient } from './marketplaceComposition';

export async function devMockIdentityAllowed(client?: SupabaseClient): Promise<boolean> {
  const c = client ?? getMarketplaceSupabaseClient();
  const { data, error } = await c.rpc('dev_mock_identity_verification_allowed');
  if (error) return false;
  return data === true;
}

export async function devGrantMockIdentityVerification(client?: SupabaseClient): Promise<void> {
  const c = client ?? getMarketplaceSupabaseClient();
  const { error } = await c.rpc('dev_grant_mock_identity_verification');
  if (error) throw new Error(error.message);
}
