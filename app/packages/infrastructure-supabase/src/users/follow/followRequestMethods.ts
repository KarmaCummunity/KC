// app/packages/infrastructure-supabase/src/users/follow/followRequestMethods.ts
// Concrete implementations of the IUserRepository follow-request methods. `follow_requests` is
// read-only for clients (the requester and the target see their own rows); every change goes
// through `follow_user`, `follow_request_decide` or `follow_request_cancel`.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FollowRequestWithUser, PaginatedRequests } from '@kc/application';
import { BackendRuleError, type FollowRequest, type FollowRequestStatus } from '@kc/domain';
import type { Database } from '../../database.types';
import { unwrapCall } from '../../rpc/mapRpcError';
import { USER_COLUMNS } from '../mapUserRow';
import { hydrateUsers } from '../userReads';
import { callFollowUser } from './followUserRpc';
import { mapFollowError } from './mapFollowError';

const REQUEST_COLUMNS = 'requester_id, target_id, status, created_at, cooldown_until' as const;

interface FollowRequestRow {
  requester_id: string;
  target_id: string;
  status: string;
  created_at: string;
  cooldown_until: string | null;
}

function rowToRequest(r: FollowRequestRow): FollowRequest {
  return {
    requesterId: r.requester_id,
    targetId: r.target_id,
    status: r.status as FollowRequestStatus,
    createdAt: r.created_at,
    cooldownUntil: r.cooldown_until,
  };
}

/**
 * FR-FOLLOW-003 — asks to follow a Private profile (`follow_user`). Repeating the call returns
 * the same pending request. On a Public profile the server follows at once; the answer is then
 * an `accepted` request, so the caller sees the follow state it would reach by approval.
 */
export async function sendRequest(
  client: SupabaseClient<Database>,
  requesterId: string,
  targetId: string,
): Promise<FollowRequest> {
  const outcome = await callFollowUser(client, targetId);
  return {
    requesterId,
    targetId,
    status: outcome === 'requested' ? 'pending' : 'accepted',
    // The RPC returns no row: the request is stamped with the client clock.
    createdAt: new Date().toISOString(),
    cooldownUntil: null,
  };
}

/**
 * Runs a request-resolving RPC. A request that is no longer pending (already decided or
 * withdrawn) is a no-op: the end state the caller asked for is already true. Any other stable
 * refusal becomes a `FollowError`.
 */
async function resolveRequest(call: () => Promise<unknown>): Promise<void> {
  try {
    await call();
  } catch (error) {
    if (!(error instanceof BackendRuleError)) throw error;
    if (error.reason !== 'follow_request_not_pending') throw mapFollowError(error);
  }
}

export function cancelRequest(
  client: SupabaseClient<Database>,
  _requesterId: string,
  targetId: string,
): Promise<void> {
  return resolveRequest(async () =>
    unwrapCall('rpc:follow_request_cancel', await client.rpc('follow_request_cancel', { p_target: targetId })),
  );
}

function decide(client: SupabaseClient<Database>, requesterId: string, accept: boolean): Promise<void> {
  return resolveRequest(async () =>
    unwrapCall(
      'rpc:follow_request_decide',
      await client.rpc('follow_request_decide', { p_requester: requesterId, p_accept: accept }),
    ),
  );
}

/** FR-FOLLOW-005 — the caller (the target) accepts; `_targetId` is the caller, the server reads it from the session. */
export function acceptRequest(client: SupabaseClient<Database>, requesterId: string, _targetId: string): Promise<void> {
  return decide(client, requesterId, true);
}

/** FR-FOLLOW-006 — the caller (the target) rejects silently; a 14-day cooldown starts for the requester. */
export function rejectRequest(client: SupabaseClient<Database>, requesterId: string, _targetId: string): Promise<void> {
  return decide(client, requesterId, false);
}

export async function listPendingRaw(client: SupabaseClient<Database>, targetId: string): Promise<FollowRequest[]> {
  const rows = unwrapCall(
    'table:follow_requests',
    await client
      .from('follow_requests')
      .select(REQUEST_COLUMNS)
      .eq('target_id', targetId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
  );
  return (rows ?? []).map(rowToRequest);
}

export async function listPendingWithUsers(
  client: SupabaseClient<Database>,
  targetId: string,
  limit: number,
  cursor?: string,
): Promise<PaginatedRequests> {
  const base = client
    .from('follow_requests')
    .select(REQUEST_COLUMNS)
    .eq('target_id', targetId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(limit);
  const rows = unwrapCall('table:follow_requests', await (cursor ? base.lt('created_at', cursor) : base)) ?? [];
  if (rows.length === 0) return { requests: [], nextCursor: null };
  const users = unwrapCall(
    'table:users',
    await client.from('users').select(USER_COLUMNS).in('id', rows.map((r) => r.requester_id)),
  );
  const hydrated = await hydrateUsers(client, users ?? []);
  const requesterById = new Map(hydrated.map((user) => [user.userId, user]));
  // A requester the caller cannot see (inactive, blocked) drops out of the list.
  const requests: FollowRequestWithUser[] = rows.flatMap((r) => {
    const requester = requesterById.get(r.requester_id);
    return requester ? [{ request: rowToRequest(r), requester }] : [];
  });
  const last = rows[rows.length - 1];
  return { requests, nextCursor: rows.length === limit && last ? last.created_at : null };
}
