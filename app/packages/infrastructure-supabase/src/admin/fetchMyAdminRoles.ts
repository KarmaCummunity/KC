import type { SupabaseClient } from '@supabase/supabase-js';
import { parseAdminRole, type AdminRole } from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

/**
 * Calls `get_my_admin_roles()` (caller's own active staff roles, `text[]`) and parses them,
 * dropping any unknown value. Returns `[]` for a non-array payload. A failed call throws
 * (`BackendUnavailableError` when the function is not deployed): the screens that gate on
 * roles treat that as "no roles", so a failure never grants access.
 *
 * Shared by the admin-role and moderation adapters so the parsing lives once.
 */
export async function fetchMyAdminRoles(client: SupabaseClient<Database>): Promise<readonly AdminRole[]> {
  const data = unwrapCall('rpc:get_my_admin_roles', await client.rpc('get_my_admin_roles'));
  if (!Array.isArray(data)) return [];
  const out: AdminRole[] = [];
  for (const raw of data) {
    const parsed = parseAdminRole(typeof raw === 'string' ? raw : null);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}
