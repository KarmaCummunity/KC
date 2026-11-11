// The organization whose books the admin money screens manage.
//
// Every baseline finance RPC takes the organization (FR-FIN-001 AC2: a finance role of one
// organization never reaches another's books). The admin portal's money section manages Karma
// Community's own books (V2-ADMIN-MONEY-9), so the finance adapters ask for the platform
// organization: the single `organizations` row with `is_platform` (readable by every member while
// active). It never changes during a session, so one read per client serves every call.
import type { SupabaseClient } from '@supabase/supabase-js';
import { FinanceLedgerError } from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapFinance } from './financeErrors';

type Client = SupabaseClient<Database>;

const cache = new WeakMap<object, Promise<string>>();

async function readPlatformOrgId(client: Client): Promise<string> {
  const row = unwrapFinance(
    'table:organizations',
    await client.from('organizations').select('id').eq('is_platform', true).maybeSingle(),
  );
  if (!row) throw new FinanceLedgerError('org_not_found', 'no platform organization');
  return row.id;
}

/** The platform organization's id; a failed read is not cached, so the next call retries. */
export function platformOrgId(client: Client): Promise<string> {
  const cached = cache.get(client);
  if (cached) return cached;
  const pending = readPlatformOrgId(client);
  cache.set(client, pending);
  pending.catch(() => cache.delete(client));
  return pending;
}
