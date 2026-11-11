import type { SupabaseClient } from '@supabase/supabase-js';
import type { CreatePostInput } from '@kc/application';
import type { Post } from '@kc/domain';
import type { Database } from '../database.types';
import { mapInsertError } from './mapInsertError';
import { fetchPostById } from './postRepoQueries';
import { upsertPostActorIdentityRow } from './postActorIdentityMethods';

export async function createPostHelper(
  client: SupabaseClient<Database>,
  input: CreatePostInput,
): Promise<Post> {
  const postPayload: Record<string, unknown> = {
    owner_id: input.ownerId,
    type: input.type,
    visibility: input.visibility,
    title: input.title,
    description: input.description,
    category: input.category,
    city: input.address.city,
    street: input.address.street,
    street_number: input.address.streetNumber,
    location_display_level: input.locationDisplayLevel,
    item_condition: input.itemCondition,
    urgency: input.urgency,
    estimated_value: input.estimatedValue ?? null,
  };
  if (input.postId) {
    postPayload.post_id = input.postId;
  }

  const { data: insertedPost, error: insertErr } = await client
    .from('posts')
    .insert(postPayload as unknown as Database['public']['Tables']['posts']['Insert'])
    .select('post_id')
    .maybeSingle();

  if (insertErr) {
    if (insertErr.code === '23505' && input.postId) {
      const existing = await fetchPostById(client, input.postId);
      if (existing) return existing;
    }
    throw mapInsertError(insertErr);
  }
  if (!insertedPost) {
    if (input.postId) {
      const existing = await fetchPostById(client, input.postId);
      if (existing) return existing;
    }
    throw new Error('create.post: no row returned');
  }

  const postId = insertedPost.post_id;

  if (input.mediaAssets.length > 0) {
    const mediaRows = input.mediaAssets.map((m, i) => ({
      post_id: postId,
      ordinal: i,
      path: m.path,
      mime_type: m.mimeType,
      size_bytes: m.sizeBytes,
    }));
    const { error: mediaErr } = await client.from('media_assets').insert(mediaRows);
    if (mediaErr) {
      await client.from('posts').delete().eq('post_id', postId);
      throw new Error(`create.media: ${mediaErr.message}`);
    }
  }

  const created = await fetchPostById(client, postId);
  if (!created) throw new Error(`create: post ${postId} disappeared after insert`);

  if (input.hideFromCounterparty) {
    try {
      await upsertPostActorIdentityRow(client, {
        postId,
        userId: input.ownerId,
        surfaceVisibility: input.visibility,
        hideFromCounterparty: true,
      });
    } catch (e) {
      await client.from('posts').delete().eq('post_id', postId);
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  return created;
}
