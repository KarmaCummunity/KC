import type { SupabaseClient } from '@supabase/supabase-js';
import type { PostActorIdentityRow, UpsertPostActorIdentityInput } from '@kc/application';
import type { PostVisibility } from '@kc/domain';
import type { Database } from '../database.legacy.types';
import { isPostgrestRelationMissing } from '../lib/postgrestRelationMissing';

function parsePostVisibility(raw: string | null | undefined): PostVisibility {
  if (raw === 'Public' || raw === 'FollowersOnly' || raw === 'OnlyMe') return raw;
  return 'Public';
}

export async function listPostActorIdentitiesForPost(
  client: SupabaseClient<Database>,
  postId: string,
): Promise<PostActorIdentityRow[]> {
  const { data, error } = await client.from('post_actor_identity').select('post_id, user_id, identity_visibility, hide_from_counterparty, surface_visibility, updated_at').eq('post_id', postId);
  if (error) {
    if (isPostgrestRelationMissing(error)) return [];
    throw new Error(`listPostActorIdentities: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    postId: row.post_id,
    userId: row.user_id,
    surfaceVisibility: parsePostVisibility(
      (row as { surface_visibility?: string }).surface_visibility ?? 'Public',
    ),
    hideFromCounterparty: row.hide_from_counterparty,
  }));
}

export async function upsertPostActorIdentityRow(
  client: SupabaseClient<Database>,
  input: UpsertPostActorIdentityInput,
): Promise<void> {
  // PostgREST `.upsert()` breaks after migration 0159 (TD-85): ON CONFLICT DO
  // UPDATE tries to assign PK columns the role cannot UPDATE. Use the 0160 RPC
  // so only user-editable columns change; `updated_at` stays trigger-stamped.
  const { error } = await client.rpc('upsert_post_actor_identity', {
    p_post_id: input.postId,
    p_surface_visibility: input.surfaceVisibility,
    p_hide_from_counterparty: input.hideFromCounterparty,
  });
  if (error) {
    if (isPostgrestRelationMissing(error)) return;
    throw new Error(`upsertPostActorIdentity: ${error.message}`);
  }
}
