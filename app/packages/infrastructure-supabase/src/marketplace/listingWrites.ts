// Publishing a listing: a post, its detail row for the worlds that have one, its photos.
//
// Rides, events and food offers are created with `create_post_with_details` (the post and its
// detail row in one transaction, published at once); every other kind is a plain post, written as
// a draft, given its photos and published with `publish_post`, so a failure half-way leaves nothing
// behind. Organization events are then attached to their organization with `set_post_organization`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ValidationError } from '@kc/domain';
import type { IMarketplaceRepository } from '@kc/application';
import type { Database, Json } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { requireRpcRow } from './rpcRow';
import { sessionUserId } from '../users/userReads';
import { loadKindCatalog, postDirectionOf } from './kindCatalog';
import {
  eventDetailColumns,
  foodDetailColumns,
  freeDetails,
  rideCityId,
  rideDetailColumns,
} from './worldDetails';

type Client = SupabaseClient<Database>;
type CreateInput = Parameters<IMarketplaceRepository['createListing']>[0];
type JsonObject = { [key: string]: Json | undefined };

/** Bucket and placeholder size of a listing photo (see `recordPhotos`). */
const PHOTO_BUCKET = 'post-images';
const PHOTO_MIME = 'image/jpeg';
/** The media pipeline re-encodes every file, so the size recorded at upload only has to be positive. */
const PHOTO_PLACEHOLDER_BYTES = 1;
/** Photos a post holds at most (`post_media.ordinal` 0..4). */
const MAX_PHOTOS = 5;

/** Records already-uploaded files as the post's photos from `firstOrdinal` on; returns how many. */
export async function recordPhotos(
  client: Client,
  postId: string,
  ownerId: string,
  paths: readonly string[],
  firstOrdinal: number,
): Promise<number> {
  const rows = paths.slice(0, Math.max(0, MAX_PHOTOS - firstOrdinal)).map((path, index) => ({
    post_id: postId,
    owner_id: ownerId,
    kind: 'image',
    storage_bucket: PHOTO_BUCKET,
    storage_key: path,
    ordinal: firstOrdinal + index,
    mime_type: PHOTO_MIME,
    size_bytes: PHOTO_PLACEHOLDER_BYTES,
  }));
  if (rows.length === 0) return 0;
  unwrapCall('table:post_media', await client.from('post_media').insert(rows));
  return rows.length;
}

/** The `p_post` document shared by every create path. */
function postDocument(input: CreateInput, kind: { world_slug: string }, direction: string, cityId: string): JsonObject {
  return {
    world_slug: kind.world_slug,
    kind_id: input.kindId,
    direction,
    title: input.title,
    description: input.summary ?? null,
    city_id: cityId,
    item_subcategory_id: input.categoryId ?? null,
    urgency_level: input.urgencyLevel ?? null,
  };
}

/** Creates a ride, an event or a food offer with its detail row; returns the post id. */
async function createWithDetails(client: Client, post: JsonObject, detailColumns: JsonObject): Promise<string> {
  return requireRpcRow(
    unwrapCall(
      'rpc:create_post_with_details',
      await client.rpc('create_post_with_details', { p_post: post as Json, p_details: detailColumns as Json }),
    ),
    'create_post_with_details',
  );
}

/** Creates a plain post: draft, photos, publish. A failure after the draft exists removes the draft. */
async function createPlain(client: Client, ownerId: string, post: JsonObject, input: CreateInput, details: JsonObject): Promise<string> {
  const row = unwrapCall(
    'table:posts',
    await client
      .from('posts')
      .insert({ ...(post as object), owner_id: ownerId, post_type: 'standard', status: 'draft', details } as never)
      .select('id')
      .single(),
  );
  const postId = (row as { id: string }).id;
  try {
    await recordPhotos(client, postId, ownerId, input.mediaPaths ?? [], 0);
    unwrapCall('rpc:publish_post', await client.rpc('publish_post', { p_post_id: postId }));
    return postId;
  } catch (error) {
    await client.from('posts').delete().eq('id', postId);
    throw error;
  }
}

/** Publishes a listing; returns its id (the post id). */
export async function createListing(client: Client, input: CreateInput): Promise<string> {
  const ownerId = await sessionUserId(client);
  if (!ownerId) throw new ValidationError('not signed in', 'owner');
  const kinds = await loadKindCatalog(client);
  const kind = kinds.byId.get(input.kindId);
  if (!kind) throw new ValidationError('unknown listing kind', 'kind');
  const direction = kind.direction === 'either' ? postDirectionOf(input.direction ?? 'give') : kind.direction;
  const form = input.details ?? {};

  if (kind.world_slug === 'rides') {
    const columns = rideDetailColumns(form, direction === 'request' ? 'request' : 'offer');
    const cityId = rideCityId(form);
    if (!columns || !cityId) throw new ValidationError('a ride needs both route ends in official places', 'route');
    const post = { ...postDocument(input, kind, direction, cityId), post_type: 'ride', details: freeDetails(form, 'rides') };
    const postId = await createWithDetails(client, post, columns);
    return postId;
  }
  const cityId = input.cityId;
  if (!cityId) throw new ValidationError('a listing needs a city', 'city');
  if (kind.slug === 'event') {
    const post = { ...postDocument(input, kind, direction, cityId), post_type: 'event', details: freeDetails(form, 'event') };
    const postId = await createWithDetails(client, post, eventDetailColumns(form));
    const orgId = typeof form['org_id'] === 'string' ? form['org_id'] : null;
    if (orgId) unwrapCall('rpc:set_post_organization', await client.rpc('set_post_organization', { p_post_id: postId, p_org_id: orgId }));
    return postId;
  }
  if (kind.world_slug === 'food' && direction === 'offer') {
    const post = { ...postDocument(input, kind, direction, cityId), details: freeDetails(form, 'food') };
    const postId = await createWithDetails(client, post, foodDetailColumns(form));
    await recordPhotos(client, postId, ownerId, input.mediaPaths ?? [], 0);
    return postId;
  }
  return createPlain(client, ownerId, postDocument(input, kind, direction, cityId), input, freeDetails(form, 'plain'));
}
