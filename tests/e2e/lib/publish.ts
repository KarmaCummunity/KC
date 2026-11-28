/**
 * Publishing a post as a seeded member, the way the app does it (production baseline, D-228):
 * a plain post is a draft, its photo and `publish_post` (an offer needs a photo); a food offer is
 * `create_post_with_details` with its detail row. Used by the journeys that need a post to exist.
 *
 * When the member's hourly `post_create` window is spent, the server answers `rate_limited`.
 * That is rewritten here so a spent E2E quota is never read as a product regression (#2444).
 */
import { rest, sessionFor, uploadPostPhoto } from './api';
import { exhaustedBudgetMessage, isRateLimitedError } from './postCreateBudget.mjs';

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

/** A post written by a member: its id, its title and the session that wrote it. */
export interface WrittenPost {
  readonly id: string;
  readonly title: string;
  readonly token: string;
  readonly userId: string;
}

/** Re-throws a spent `post_create` window with a message that names the hourly limit. */
function rethrowRateLimited(email: string, err: unknown): never {
  if (isRateLimitedError(err)) throw new Error(exhaustedBudgetMessage({ email }), { cause: err });
  throw err;
}

/** Publishes as `user`; returns the post id and its title. */
export async function publishPostAs(user: Credentials, journey: PostToPublish): Promise<{ id: string; title: string }> {
  try {
    const { id, title } = await publishPostAsUnchecked(user, journey);
    return { id, title };
  } catch (err) {
    rethrowRateLimited(user.email, err);
  }
}

/**
 * Creates the post as a draft with no photo, through the same write the app uses for its kind
 * (a draft row for `plain`, `create_post_with_details` with `"status": "draft"` for `food`).
 * Lets a journey call `publish_post` itself, e.g. to prove that an offer without a photo is refused.
 */
export async function createDraftAs(user: Credentials, journey: PostToPublish): Promise<WrittenPost> {
  try {
    return await createDraftAsUnchecked(user, journey);
  } catch (err) {
    rethrowRateLimited(user.email, err);
  }
}

/** The member's session and the columns every new post carries (kind, direction, title, city). */
async function newPostColumns(user: Credentials, journey: PostToPublish) {
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
  const post = {
    world_slug: journey.world,
    kind_id: kind.id,
    direction: kind.direction,
    title: journey.title,
    description: null,
    city_id: city.city_id,
  };
  return { token, userId, post };
}

/** Food: one `create_post_with_details` call; `draft` keeps the post unpublished. */
async function createFoodPost(token: string, post: Record<string, unknown>, journey: PostToPublish, draft: boolean) {
  const id = await rest<string>(token, 'rpc/create_post_with_details', {
    method: 'POST',
    body: { p_post: { ...post, details: {}, ...(draft ? { status: 'draft' } : {}) }, p_details: journey.details() },
  });
  if (typeof id !== 'string') throw new Error(`create_post_with_details returned ${JSON.stringify(id)}`);
  return id;
}

async function createDraftAsUnchecked(user: Credentials, journey: PostToPublish): Promise<WrittenPost> {
  const { token, userId, post } = await newPostColumns(user, journey);
  if (journey.publish === 'food') {
    return { id: await createFoodPost(token, post, journey, true), title: journey.title, token, userId };
  }
  const [draft] = await rest<{ id: string }[]>(token, 'posts', {
    method: 'POST',
    body: { ...post, owner_id: userId, post_type: 'standard', status: 'draft', details: journey.details() },
  });
  if (!draft) throw new Error('the draft post was not created');
  return { id: draft.id, title: journey.title, token, userId };
}

async function publishPostAsUnchecked(user: Credentials, journey: PostToPublish): Promise<WrittenPost> {
  if (journey.publish === 'food') {
    const { token, userId, post } = await newPostColumns(user, journey);
    return { id: await createFoodPost(token, post, journey, false), title: journey.title, token, userId };
  }
  const draft = await createDraftAsUnchecked(user, journey);
  const key = await uploadPostPhoto(draft.token, draft.userId);
  await rest(draft.token, 'post_media', {
    method: 'POST',
    body: {
      post_id: draft.id,
      owner_id: draft.userId,
      kind: 'image',
      storage_bucket: 'post-images',
      storage_key: key,
      ordinal: 0,
      mime_type: 'image/png',
      size_bytes: 1,
    },
  });
  await rest(draft.token, 'rpc/publish_post', { method: 'POST', body: { p_post_id: draft.id } });
  return draft;
}
