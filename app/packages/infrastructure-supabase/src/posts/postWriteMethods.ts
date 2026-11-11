// Creating, editing and deleting a post against the baseline (FR-POST-001..008, FR-POST-021).
//
// A post is written as a draft, completed (exact street, photos, who sees the poster) and only then
// published with `publish_post`: a device may delete a draft but never a published post, so a
// failure half-way leaves nothing behind. Status is never written directly (it moves through RPCs).

import type { SupabaseClient } from '@supabase/supabase-js';
import { PostError, type CreatePostInput, type UpdatePostInput } from '@kc/application';
import { BackendRuleError, type Category } from '@kc/domain';
import type { Database, Json } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { sessionUserId } from '../users/userReads';
import { toPostError } from './postErrors';
import { ITEMS_WORLD, directionOf, loadPostCatalog, requireKindId, requireSubcategoryId } from './postCatalog';
import { replacePostMedia, writePostMedia } from './postMediaWrites';
import { upsertPostActorIdentityRow } from './postActorIdentityMethods';

type Client = SupabaseClient<Database>;

/** The free `details` document of a generic post: condition, estimated value, urgency note. */
function buildDetails(input: {
  itemCondition?: string | null;
  estimatedValue?: number | null;
  urgency?: string | null;
}): { [key: string]: Json } {
  const details: { [key: string]: Json } = {};
  if (input.itemCondition) details['item_condition'] = input.itemCondition;
  if (input.estimatedValue !== null && input.estimatedValue !== undefined) {
    details['estimated_value'] = input.estimatedValue;
  }
  if (input.urgency) details['urgency_note'] = input.urgency;
  return details;
}

/** Writes the exact address (owner-only table); a post without a street has no row. */
async function writePrivateLocation(
  client: Client,
  postId: string,
  address: { street: string; streetNumber: string },
): Promise<void> {
  const street = address.street.trim();
  if (street.length === 0) return;
  const streetNumber = address.streetNumber.trim();
  unwrapCall(
    'table:post_private_locations',
    await client
      .from('post_private_locations')
      .upsert(
        { post_id: postId, street, street_number: streetNumber.length > 0 ? streetNumber : null },
        { onConflict: 'post_id' },
      ),
  );
}

async function insertDraft(client: Client, input: CreatePostInput): Promise<string> {
  const catalog = await loadPostCatalog(client);
  const row = unwrapCall(
    'table:posts',
    await client
      .from('posts')
      .insert({
        owner_id: input.ownerId,
        world_slug: ITEMS_WORLD,
        kind_id: requireKindId(catalog, input.type),
        post_type: 'standard',
        direction: directionOf(input.type),
        status: 'draft',
        visibility: input.visibility,
        title: input.title,
        description: input.description,
        item_subcategory_id: requireSubcategoryId(catalog, input.category),
        details: buildDetails(input),
        city_id: input.address.city,
        location_display_level: input.locationDisplayLevel,
      })
      .select('id')
      .single(),
  );
  if (!row) throw new PostError('unknown', 'create: no row returned');
  return row.id;
}

async function completeDraft(client: Client, postId: string, input: CreatePostInput): Promise<void> {
  await writePrivateLocation(client, postId, input.address);
  await writePostMedia(client, postId, input.ownerId, input.mediaAssets);
  if (input.hideFromCounterparty) {
    await upsertPostActorIdentityRow(client, {
      postId,
      userId: input.ownerId,
      surfaceVisibility: input.visibility,
      hideFromCounterparty: true,
    });
  }
  unwrapCall('rpc:publish_post', await client.rpc('publish_post', { p_post_id: postId }));
}

/** Creates and publishes a post; returns its id. A failure after the draft exists removes the draft. */
export async function createPost(client: Client, input: CreatePostInput): Promise<string> {
  let postId: string | null = null;
  try {
    postId = await insertDraft(client, input);
    await completeDraft(client, postId, input);
    return postId;
  } catch (error) {
    if (postId) await client.from('posts').delete().eq('id', postId);
    throw toPostError(error);
  }
}

/** The `posts` columns an edit changes. `details` is merged by the caller, never replaced blindly. */
function buildPostPatch(patch: UpdatePostInput, categoryId: string | null): Database['public']['Tables']['posts']['Update'] {
  const row: Database['public']['Tables']['posts']['Update'] = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.visibility !== undefined) row.visibility = patch.visibility;
  if (patch.locationDisplayLevel !== undefined) row.location_display_level = patch.locationDisplayLevel;
  if (patch.address) row.city_id = patch.address.city;
  if (categoryId) row.item_subcategory_id = categoryId;
  return row;
}

/** The post's current `details` with the edited condition / urgency applied. */
async function mergedDetails(client: Client, postId: string, patch: UpdatePostInput): Promise<Json | undefined> {
  if (patch.itemCondition === undefined && patch.urgency === undefined) return undefined;
  const current = unwrapCall(
    'table:posts',
    await client.from('posts').select('details').eq('id', postId).maybeSingle(),
  );
  const base = (current?.details ?? {}) as { [key: string]: Json };
  const next: { [key: string]: Json } = { ...base };
  if (patch.itemCondition !== undefined) delete next['item_condition'];
  if (patch.urgency !== undefined) delete next['urgency_note'];
  return { ...next, ...buildDetails({ itemCondition: patch.itemCondition, urgency: patch.urgency }) };
}

async function categoryIdOf(client: Client, category: Category | undefined): Promise<string | null> {
  if (!category) return null;
  return requireSubcategoryId(await loadPostCatalog(client), category);
}

/** Applies an edit: content columns, exact address, photos. Throws `post_not_open` when no row is editable. */
export async function updatePost(client: Client, postId: string, patch: UpdatePostInput): Promise<void> {
  try {
    const row = buildPostPatch(patch, await categoryIdOf(client, patch.category));
    const details = await mergedDetails(client, postId, patch);
    if (details !== undefined) row.details = details;
    if (Object.keys(row).length > 0) {
      const updated = unwrapCall(
        'table:posts',
        await client.from('posts').update(row).eq('id', postId).select('id'),
      );
      // Row-level security lets the owner edit a draft, open or paused post only; any other post
      // matches no row, which PostgREST reports as an empty success.
      if (!updated || updated.length === 0) throw new PostError('post_not_open', 'update: no editable post');
    }
    if (patch.address) await writePrivateLocation(client, postId, patch.address);
    if (patch.mediaAssets !== undefined) {
      const ownerId = await sessionUserId(client);
      if (!ownerId) throw new PostError('forbidden', 'update: not signed in');
      await replacePostMedia(client, postId, ownerId, patch.mediaAssets);
    }
  } catch (error) {
    throw toPostError(error);
  }
}

/** Deletes a post of any status the owner may delete; a published one is kept seven days for a reopen. */
export async function deletePost(client: Client, postId: string): Promise<void> {
  try {
    unwrapCall('rpc:delete_post', await client.rpc('delete_post', { p_post_id: postId }));
  } catch (error) {
    const wrongStatus = error instanceof BackendRuleError && error.reason === 'listing_wrong_status';
    throw wrongStatus ? new PostError('post_owner_delete_forbidden', error.reason, error) : toPostError(error);
  }
}

/** FR-ADMIN-009: moves a post to `removed_admin`; the server checks the caller's staff role. */
export async function adminRemovePost(client: Client, postId: string): Promise<void> {
  try {
    unwrapCall('rpc:admin_remove_post', await client.rpc('admin_remove_post', { p_post_id: postId }));
  } catch (error) {
    throw toPostError(error);
  }
}
