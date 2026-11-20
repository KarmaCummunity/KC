// FR-ADMIN-037 AC13 — adapter of the "Copied from production" card over the two RPCs of the
// dev-only production-copy tools (supabase/seed/prod-copy, installed on kc-dev by every dev
// deploy). Like the demo-data RPCs they are not in the production baseline, so the generated
// `Database` type does not list them and they are called through an untyped view of the client.
// Refusals map exactly as the demo-data ones (toDemoDataError): `not_installed` on kc-prod.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IProdCopyRepository } from '@kc/application';
import { DemoDataError, type ProdCopyDeleteResult, type ProdCopyStatus } from '@kc/domain';
import type { Database } from '../database.types';
import type { CallResult } from '../rpc/mapRpcError';
import { toDemoDataError } from './demoDataRows';

type Row = Record<string, unknown>;

const untyped = (client: SupabaseClient<Database>): SupabaseClient => client as unknown as SupabaseClient;
function invalidResponse(): never {
  throw new DemoDataError('unknown', 'Invalid production-copy response');
}
const asRow = (data: unknown): Row =>
  data !== null && typeof data === 'object' && !Array.isArray(data) ? (data as Row) : invalidResponse();
/** Only actual nonnegative integer counts are evidence of state or deletion. */
const count = (row: Row, key: string): number => {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return invalidResponse();
  return value;
};

function unwrap(rpc: string, result: CallResult<unknown>): Row {
  if (result.error) throw toDemoDataError(rpc, result.error);
  return asRow(result.data);
}

export function mapProdCopyStatus(r: Row): ProdCopyStatus {
  const copiedAt = r.last_copied_at;
  if (typeof r.is_dev_environment !== 'boolean' ||
      (copiedAt !== null && (typeof copiedAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T/.test(copiedAt) || !Number.isFinite(Date.parse(copiedAt))))) {
    return invalidResponse();
  }
  return {
    members: count(r, 'members'),
    posts: count(r, 'posts'),
    organizations: count(r, 'organizations'),
    follows: count(r, 'follows'),
    savedPosts: count(r, 'saved_posts'),
    lastCopiedAt: copiedAt,
  };
}

export class SupabaseProdCopyRepository implements IProdCopyRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async getStatus(): Promise<ProdCopyStatus> {
    const result = await untyped(this.client).rpc('admin_prod_copy_status');
    return mapProdCopyStatus(unwrap('admin_prod_copy_status', result));
  }

  async deleteAll(): Promise<ProdCopyDeleteResult> {
    const r = unwrap('admin_delete_prod_copy', await untyped(this.client).rpc('admin_delete_prod_copy'));
    return { members: count(r, 'members'), posts: count(r, 'posts'), organizations: count(r, 'organizations') };
  }
}
