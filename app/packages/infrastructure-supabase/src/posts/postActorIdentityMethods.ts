// FR-POST-021 — per-participant audience and identity mask of a post.
//
// A member reads only their own `post_actor_identity` row (RLS); the mask other members see is
// applied by the server inside `post_card` and `post_comments_page`, not on the device. Writes go
// through `upsert_post_actor_identity`, which also moves `posts.visibility` for the owner of a
// delivered post.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PostActorIdentityRow, UpsertPostActorIdentityInput } from '@kc/application';
import type { PostVisibility } from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { toPostError } from './postErrors';

function asVisibility(raw: string): PostVisibility {
  return raw === 'FollowersOnly' || raw === 'OnlyMe' ? raw : 'Public';
}

/** The caller's identity rows of a post (zero or one: another member's row is not readable). */
export async function listPostActorIdentitiesForPost(
  client: SupabaseClient<Database>,
  postId: string,
): Promise<PostActorIdentityRow[]> {
  const rows = unwrapCall(
    'table:post_actor_identity',
    await client
      .from('post_actor_identity')
      .select('post_id, user_id, surface_visibility, hide_from_counterparty')
      .eq('post_id', postId),
  );
  return (rows ?? []).map((row) => ({
    postId: row.post_id,
    userId: row.user_id,
    surfaceVisibility: asVisibility(row.surface_visibility),
    hideFromCounterparty: row.hide_from_counterparty,
  }));
}

/** Sets the caller's audience and the "hide me from the counterparty" flag for a post. */
export async function upsertPostActorIdentityRow(
  client: SupabaseClient<Database>,
  input: UpsertPostActorIdentityInput,
): Promise<void> {
  try {
    unwrapCall(
      'rpc:upsert_post_actor_identity',
      await client.rpc('upsert_post_actor_identity', {
        p_post_id: input.postId,
        p_surface_visibility: input.surfaceVisibility,
        p_hide_from_counterparty: input.hideFromCounterparty,
      }),
    );
  } catch (error) {
    throw toPostError(error);
  }
}
