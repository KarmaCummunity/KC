/**
 * Publishing a post as a seeded member, the way the app does it (production baseline, D-228):
 * a plain post is a draft, its photo and `publish_post` (an offer needs a photo); a food offer is
 * `create_post_with_details` with its detail row. Used by the journeys that need a post to exist.
 */
import { rest, sessionFor, uploadPostPhoto } from './api';

type Credentials = { email: string; password: string };

export interface PostToPublish {
  /** Post world slug (`items`, `food`). */
  readonly world: string;
  /** `post_kinds.slug` of the post (`item_offer`, `food_offer`). */
  readonly kindSlug: string;
  readonly title: string;
  /** `plain`: draft + photo + `publish_post`; `food`: `create_post_with_details`. */
  readonly publish: 'plain' | 'food';
  /** The detail row for `food` (`expires_at`, `allergens`, `kosher`); free details for `plain`. */
  readonly details: () => Record<string, unknown>;
}

/** Publishes as `user`; returns the post id and its title. */
export async function publishPostAs(user: Credentials, journey: PostToPublish): Promise<{ id: string; title: string }> {
  const { session } = await sessionFor(user);
  const token = session.access_token as string;
  const userId = (session.user as { id: string }).id;
  const [kind] = await rest<{ id: string; direction: string }[]>(
    token,
    `post_kinds?select=id,direction&world_slug=eq.${journey.world}&slug=eq.${journey.kindSlug}&limit=1`,
  );
  if (!kind) throw new Error(`post kind ${journey.world}/${journey.kindSlug} is missing on kc-dev`);
  const [city] = await rest<{ city_id: string }[]>(token, 'cities?select=city_id&city_id=eq.7400&limit=1');
  if (!city) throw new Error('city 7400 is missing from the reference seed on kc-dev');
  const title = journey.title;
  const post = {
    world_slug: journey.world,
    kind_id: kind.id,
    direction: kind.direction,
    title,
    description: null,
    city_id: city.city_id,
  };
  if (journey.publish === 'food') {
    const id = await rest<string>(token, 'rpc/create_post_with_details', {
      method: 'POST',
      body: { p_post: { ...post, details: {} }, p_details: journey.details() },
    });
    if (typeof id !== 'string') throw new Error(`create_post_with_details returned ${JSON.stringify(id)}`);
    return { id, title };
  }
  const [draft] = await rest<{ id: string }[]>(token, 'posts', {
    method: 'POST',
    body: { ...post, owner_id: userId, post_type: 'standard', status: 'draft', details: journey.details() },
  });
  if (!draft) throw new Error('the draft post was not created');
  const key = await uploadPostPhoto(token, userId);
  await rest(token, 'post_media', {
    method: 'POST',
    body: {
      post_id: draft.id,
      owner_id: userId,
      kind: 'image',
      storage_bucket: 'post-images',
      storage_key: key,
      ordinal: 0,
      mime_type: 'image/png',
      size_bytes: 1,
    },
  });
  await rest(token, 'rpc/publish_post', { method: 'POST', body: { p_post_id: draft.id } });
  return { id: draft.id, title };
}
