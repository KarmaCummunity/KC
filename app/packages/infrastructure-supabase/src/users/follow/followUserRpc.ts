// `follow_user(p_target)` — the one way a follow edge or a follow request comes into being
// (15_social_graph/040_follow_rpcs.sql). The server decides which of the two a "follow" becomes:
// an edge at once on a public profile, a pending request on a private one. Repeating the call
// returns the same answer without a second row.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FollowOutcome } from '@kc/application';
import type { Database } from '../../database.types';
import { unwrapCall } from '../../rpc/mapRpcError';
import { mapRuleErrors } from '../../auth/ruleErrors';
import { mapFollowError } from './mapFollowError';

/** Calls `follow_user`; a stable refusal becomes a `FollowError`. */
export async function callFollowUser(client: SupabaseClient<Database>, targetId: string): Promise<FollowOutcome> {
  const outcome = await mapRuleErrors(
    async () => unwrapCall('rpc:follow_user', await client.rpc('follow_user', { p_target: targetId })),
    (_reason, error) => mapFollowError(error),
  );
  if (outcome !== 'following' && outcome !== 'requested') throw new Error(`follow_user: unexpected answer ${outcome}`);
  return outcome;
}
