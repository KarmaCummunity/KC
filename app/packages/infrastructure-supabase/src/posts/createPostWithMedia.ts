// Items post-engine create: the post row and its photos in one transaction (KC#2020, D132).
// Kept out of SupabasePostRepository so that file stays under its size cap (TD-50).
//
// The server checks at commit that an items offer (`Give`) has at least one photo
// (`posts_offer_photo_required`, migration 0741). Two separate requests (insert the post,
// then insert `media_assets`) would each commit on their own, so the post would be refused
// before its photos arrived; `create_post_with_media` writes both in one call instead.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CreatePostInput } from '@kc/application';
import type { Database } from '../database.types';
import { mapInsertError } from './mapInsertError';

/** The `posts` columns the composer writes, as `create_post_with_media` reads them (`p_post`). */
export function buildCreatePostPayload(input: CreatePostInput) {
  return {
    ...(input.postId ? { post_id: input.postId } : {}),
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
}

/** The photos in display order; the server stores each one's array index as its `ordinal`. */
export function buildCreatePostMedia(input: CreatePostInput) {
  return input.mediaAssets.map((m) => ({
    path: m.path,
    mime_type: m.mimeType,
    size_bytes: m.sizeBytes,
  }));
}

/**
 * Creates the post and its photos atomically and returns the new post id.
 * The owner is always the signed-in caller (the RPC ignores any owner in the payload).
 * Server errors become typed `PostError`s through `mapInsertError`.
 */
export async function createPostWithMedia(
  client: SupabaseClient<Database>,
  input: CreatePostInput,
): Promise<string> {
  const { data, error } = await client.rpc('create_post_with_media', {
    p_post: buildCreatePostPayload(input),
    p_media: buildCreatePostMedia(input),
  });
  if (error) throw mapInsertError(error);
  if (!data) throw new Error('create.post: no row returned');
  return data;
}
