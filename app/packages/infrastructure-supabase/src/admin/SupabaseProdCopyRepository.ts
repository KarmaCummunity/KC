// FR-ADMIN-037 AC13 — adapter of the "Copied from production" card over the two RPCs of the
// dev-only production-copy tools (supabase/seed/prod-copy, installed on kc-dev by every dev
// deploy). Like the demo-data RPCs they are not in the production baseline, so the generated
// `Database` type does not list them and they are called through an untyped view of the client.
// Refusals map exactly as the demo-data ones (toDemoDataError): `not_installed` on kc-prod.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IProdCopyRepository } from '@kc/application';
import type { ProdCopyDeleteResult, ProdCopyStatus } from '@kc/domain';
import type { Database } from '../database.types';
import type { CallResult } from '../rpc/mapRpcError';
import { toDemoDataError } from './demoDataRows';

type Row = Record<string, unknown>;

const untyped = (client: SupabaseClient<Database>): SupabaseClient => client as unknown as SupabaseClient;
const asRow = (data: unknown): Row =>
  data !== null && typeof data === 'object' && !Array.isArray(data) ? (data as Row) : {};
/** A missing or malformed count reads as 0, never NaN. */
const count = (row: Row, key: string): number => Number(row[key] ?? 0) || 0;

function unwrap(rpc: string, result: CallResult<unknown>): Row {
  if (result.error) throw toDemoDataError(rpc, result.error);
  return asRow(result.data);
}

export function mapProdCopyStatus(r: Row): ProdCopyStatus {
  return {
    members: count(r, 'members'),
    posts: count(r, 'posts'),
    organizations: count(r, 'organizations'),
    follows: count(r, 'follows'),
    savedPosts: count(r, 'saved_posts'),
    lastCopiedAt: typeof r.last_copied_at === 'string' ? r.last_copied_at : null,
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
