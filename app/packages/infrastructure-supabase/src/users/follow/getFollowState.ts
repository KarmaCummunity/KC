// app/packages/infrastructure-supabase/src/users/follow/getFollowState.ts
// Single-round-trip probe for FR-FOLLOW-011 state derivation. Runs four targeted queries in
// parallel; each query reads at most a single row.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FollowStateRaw } from '@kc/application';
import type { Database } from '../../database.types';
import { unwrapCall } from '../../rpc/mapRpcError';

export async function fetchFollowStateRaw(
  client: SupabaseClient<Database>,
  viewerId: string,
  targetUserId: string,
): Promise<FollowStateRaw> {
  const [targetRes, edgeRes, pendingRes, cooldownRes] = await Promise.all([
    client.from('users').select('id, privacy_mode').eq('id', targetUserId).maybeSingle(),
    client.from('follows').select('follower_id').eq('follower_id', viewerId).eq('followed_id', targetUserId).maybeSingle(),
    client
      .from('follow_requests')
      .select('requester_id')
      .eq('requester_id', viewerId)
      .eq('target_id', targetUserId)
      .eq('status', 'pending')
      .maybeSingle(),
    client
      .from('follow_requests')
      .select('cooldown_until')
      .eq('requester_id', viewerId)
      .eq('target_id', targetUserId)
      .eq('status', 'rejected')
      .gt('cooldown_until', new Date().toISOString())
      .order('cooldown_until', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const target = unwrapCall('table:users', targetRes);
  const edge = unwrapCall('table:follows', edgeRes);
  const pending = unwrapCall('table:follow_requests', pendingRes);
  const cooldown = unwrapCall('table:follow_requests', cooldownRes);

  return {
    // The policy shows a profile only while it is active (and not blocked), and `user_account`
    // is not readable for another member: a visible target is therefore an `active` one.
    target: target
      ? { userId: target.id, privacyMode: target.privacy_mode === 'Private' ? 'Private' : 'Public', accountStatus: 'active' }
      : null,
    followingExists: edge !== null,
    pendingRequestExists: pending !== null,
    cooldownUntil: cooldown?.cooldown_until ?? null,
  };
}
