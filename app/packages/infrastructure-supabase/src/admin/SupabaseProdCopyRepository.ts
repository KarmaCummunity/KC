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
const asRow = (data: unknown): Row =>
  data !== null && typeof data === 'object' && !Array.isArray(data) ? (data as Row) : {};

/**
 * Unlike the demo-data mapping, nothing here defaults: the card says what the copy holds and when
 * it last succeeded, so an answer that does not prove it (an empty or partial body, a count that
 * is not a whole number) is `outdated` (the installed seed does not match this build), never an
 * empty copy or "deleted 0".
 */
function requireCount(rpc: string, row: Row, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new DemoDataError('outdated', `${rpc}: no valid ${key}`);
  }
  return value;
}

function unwrap(rpc: string, result: CallResult<unknown>): Row {
  if (result.error) throw toDemoDataError(rpc, result.error);
  return asRow(result.data);
}

/**
 * The status as the server proves it. `last_copied_at` must be present: a time (only a committed,
 * successful copy writes it) or null (no copy has succeeded yet).
 */
export function mapProdCopyStatus(r: Row): ProdCopyStatus {
  const at = r.last_copied_at;
  if (!(at === null || (typeof at === 'string' && !Number.isNaN(Date.parse(at))))) {
    throw new DemoDataError('outdated', 'admin_prod_copy_status: no valid last_copied_at');
  }
  const need = (key: string) => requireCount('admin_prod_copy_status', r, key);
  return {
    members: need('members'),
    posts: need('posts'),
    organizations: need('organizations'),
    follows: need('follows'),
    savedPosts: need('saved_posts'),
    lastCopiedAt: at,
  };
}

export class SupabaseProdCopyRepository implements IProdCopyRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async getStatus(): Promise<ProdCopyStatus> {
    const result = await untyped(this.client).rpc('admin_prod_copy_status');
    return mapProdCopyStatus(unwrap('admin_prod_copy_status', result));
  }

  async deleteAll(): Promise<ProdCopyDeleteResult> {
    // RPC names stay literal at each call: scripts/db-usage-inventory.mjs reads them from the call.
    const r = unwrap('admin_delete_prod_copy', await untyped(this.client).rpc('admin_delete_prod_copy'));
    const need = (key: string) => requireCount('admin_delete_prod_copy', r, key);
    return { members: need('members'), posts: need('posts'), organizations: need('organizations') };
  }
}
