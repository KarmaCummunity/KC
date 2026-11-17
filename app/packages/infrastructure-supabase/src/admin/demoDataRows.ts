// FR-ADMIN-031 — mapping of the demo-data RPCs' jsonb answers (supabase/seed/demo) and of their
// refusals. Every key is read defensively, so a missing count becomes 0, never NaN.
import {
  BackendUnavailableError,
  DEMO_DATA_SERVER_ERROR_CODES,
  DemoDataError,
  type DemoDataErrorCode,
  type DemoDataSeedResult,
  type DemoDataStatus,
  type DemoDataStep,
  type DemoDataWipeResult,
} from '@kc/domain';
import { toBackendUnavailable, type BackendErrorLike } from '../rpc/backendUnavailable';

type Row = Record<string, unknown>;

const asRow = (data: unknown): Row =>
  data !== null && typeof data === 'object' && !Array.isArray(data) ? (data as Row) : {};
const count = (row: Row, key: string): number => Number(row[key] ?? 0) || 0;

export function mapDemoDataStatus(data: unknown): DemoDataStatus {
  const r = asRow(data);
  return {
    demoUsers: count(r, 'demo_users'),
    demoOrganizations: count(r, 'demo_organizations'),
    demoItemPosts: count(r, 'demo_item_posts'),
    demoRidePosts: count(r, 'demo_ride_posts'),
    demoFollows: count(r, 'demo_follows'),
    demoChats: count(r, 'demo_chats'),
    demoOrgMemberships: count(r, 'demo_org_memberships'),
    canSeed: r.can_seed === true,
    hasSavedPassword: r.has_saved_password === true,
  };
}

export function mapDemoDataWipeResult(data: unknown): DemoDataWipeResult {
  const r = asRow(data);
  return {
    usersDeleted: count(r, 'users_deleted'),
    postsDeleted: count(r, 'posts_deleted'),
    chatsDeleted: count(r, 'chats_deleted'),
    organizationsDeleted: count(r, 'organizations_deleted'),
    organizationsKept: count(r, 'organizations_kept'),
  };
}

/** A restore answers with the same counts as the status (what exists once it is done). */
export function mapDemoDataSeedResult(data: unknown): DemoDataSeedResult {
  const s = mapDemoDataStatus(data);
  return {
    users: s.demoUsers,
    itemPosts: s.demoItemPosts,
    ridePosts: s.demoRidePosts,
    follows: s.demoFollows,
    chats: s.demoChats,
    organizations: s.demoOrganizations,
    orgMemberships: s.demoOrgMemberships,
  };
}

/** One step's answer: `{ done, progress_key, result? }`. */
export function mapDemoDataStep<R>(data: unknown, mapResult: (raw: unknown) => R): DemoDataStep<R> {
  const r = asRow(data);
  const done = r.done === true;
  return {
    done,
    progressKey: typeof r.progress_key === 'string' ? r.progress_key : null,
    result: done && r.result !== undefined && r.result !== null ? mapResult(r.result) : null,
  };
}

const SERVER_CODES: ReadonlySet<string> = new Set(DEMO_DATA_SERVER_ERROR_CODES);
/** Postgres `query_canceled`: the request's statement timeout. */
const STATEMENT_TIMEOUT = '57014';

/**
 * A failed demo-data call as a DemoDataError. A database without the tools (kc-prod, or kc-dev
 * before the Seed KC dev workflow's `demo` action) answers "function not found": `not_installed`.
 */
export function toDemoDataError(rpc: string, err: BackendErrorLike): DemoDataError {
  const message = (err.message ?? '').trim();
  if (SERVER_CODES.has(message)) return new DemoDataError(message as DemoDataErrorCode);
  const missing: BackendUnavailableError | null = toBackendUnavailable(`rpc:${rpc}`, err);
  if (missing) return new DemoDataError('not_installed', missing.message);
  if (err.code === '42501') return new DemoDataError('forbidden');
  if (err.code === STATEMENT_TIMEOUT) return new DemoDataError('timeout');
  return new DemoDataError('unknown', message || 'demo data call failed');
}
