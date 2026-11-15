import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

type AuditSearchFunction = Database['public']['Functions']['admin_audit_search'];

/** One audit event as `admin_audit_search` returns it (ids only; names are resolved by callers). */
export type AuditRpcRow = AuditSearchFunction['Returns'][number];

/**
 * One keyset page of the audit trail, newest first. The server scopes it by the caller's role
 * (super admin: everything; moderator: own events and events about them; support: own events)
 * and caps `p_limit` at 200. Shared by the audit screen, the case timeline and the per-member
 * audit lookup so the call and its error mapping live once.
 */
export async function callAuditSearch(
  client: SupabaseClient<Database>,
  args: AuditSearchFunction['Args'],
): Promise<AuditRpcRow[]> {
  const data = unwrapCall('rpc:admin_audit_search', await client.rpc('admin_audit_search', args));
  return Array.isArray(data) ? data : [];
}
