import type { SupabaseClient } from '@supabase/supabase-js';
import type { PostWithOwner } from '@kc/application';
import {
  projectActorIdentityForViewer,
  type ActorIdentityInput,
  type PostActorIdentityExposure,
  type PostVisibility,
} from '@kc/domain';
import type { Database } from '../database.types';
import { isPostgrestRelationMissing } from '../lib/postgrestRelationMissing';

type IdentityRowDb = Database['public']['Tables']['post_actor_identity']['Row'];

function asExposure(raw: string): PostActorIdentityExposure {
  if (raw === 'FollowersOnly' || raw === 'Hidden' || raw === 'Public') return raw;
  return 'Public';
}

function asSurfaceVisibility(raw: string | null | undefined): PostVisibility {
  if (raw === 'FollowersOnly' || raw === 'OnlyMe' || raw === 'Public') return raw;
  return 'Public';
}

export async function fetchFollowedTargets(
  client: SupabaseClient<Database>,
  viewerId: string,
  candidateIds: string[],
): Promise<Set<string>> {
  const uniq = [...new Set(candidateIds.filter(Boolean))];
  if (uniq.length === 0) return new Set();
  const { data, error } = await client
    .from('follow_edges')
    .select('followed_id')
    .eq('follower_id', viewerId)
    .in('followed_id', uniq);
  if (error) throw new Error(`fetchFollowedTargets: ${error.message}`);
  const set = new Set<string>();
  for (const row of data ?? []) {
    set.add((row as { followed_id: string }).followed_id);
  }
  return set;
}

export async function fetchPostActorIdentitiesByPostIds(
  client: SupabaseClient<Database>,
  postIds: string[],
): Promise<Map<string, Map<string, IdentityRowDb>>> {
  const out = new Map<string, Map<string, IdentityRowDb>>();
  if (postIds.length === 0) return out;
  const uniqueIds = [...new Set(postIds)];
  const { data, error } = await client
    .from('post_actor_identity')
    .select('post_id, user_id, identity_visibility, hide_from_counterparty, surface_visibility, updated_at')
    .in('post_id', uniqueIds);
  if (error) {
    if (isPostgrestRelationMissing(error)) return out;
    throw new Error(`fetchPostActorIdentitiesByPostIds: ${error.message}`);
  }
  for (const raw of (data ?? []) as IdentityRowDb[]) {
    if (!out.has(raw.post_id)) out.set(raw.post_id, new Map());
    out.get(raw.post_id)!.set(raw.user_id, raw);
  }
  return out;
}

function policyFor(
  identities: Map<string, IdentityRowDb>,
  userId: string,
): {
  exposure: PostActorIdentityExposure;
  hideFromCounterparty: boolean;
  surfaceVisibility: PostVisibility;
} {
  const row = identities.get(userId);
  if (!row) return { exposure: 'Public', hideFromCounterparty: false, surfaceVisibility: 'Public' };
  return {
    exposure: asExposure(row.identity_visibility),
    hideFromCounterparty: row.hide_from_counterparty,
    surfaceVisibility: asSurfaceVisibility(row.surface_visibility),
  };
}

function ownerActorFrom(post: PostWithOwner): ActorIdentityInput {
  return {
    userId: post.ownerId,
    displayName: post.ownerName ?? '',
    shareHandle: post.ownerHandle,
    avatarUrl: post.ownerAvatarUrl,
  };
}

function recipientActorFrom(post: PostWithOwner): ActorIdentityInput | null {
  const r = post.recipientUser;
  if (!r) return null;
  return {
    userId: r.userId,
    displayName: r.displayName ?? '',
    shareHandle: r.shareHandle,
    avatarUrl: r.avatarUrl,
  };
}

export type ApplyPostActorIdentityProjectionOptions = {
  /** Whose profile "closed posts" grid is being rendered — drives D-31 third-party mask. */
  readonly identityListingHostUserId?: string | null;
  /** Already loaded with the post rows, so a dropped second request is not required. */
  readonly prefetchedIdentities?: Map<string, Map<string, IdentityRowDb>>;
};

function projectSingle(
  post: PostWithOwner,
  viewerId: string | null,
  identities: Map<string, IdentityRowDb>,
  followed: Set<string>,
  identityListingHostUserId: string | null,
): PostWithOwner {
  const recipientId = post.recipientUser?.userId ?? post.recipient?.recipientUserId ?? null;

  const ownerActor = ownerActorFrom(post);
  const ownerPolicy = policyFor(identities, post.ownerId);
  const ownerSurface: PostVisibility =
    ownerPolicy.surfaceVisibility !== 'Public' ? ownerPolicy.surfaceVisibility : post.visibility;
  const ownerProj = projectActorIdentityForViewer(ownerActor, ownerPolicy.exposure, {
    viewerUserId: viewerId,
    viewerFollowsActor: viewerId ? followed.has(post.ownerId) : false,
    isCounterparty: Boolean(viewerId && recipientId && viewerId === recipientId),
    hideFromCounterparty: ownerPolicy.hideFromCounterparty,
    actorSurfaceVisibility: ownerSurface,
    counterpartyUserId: recipientId,
    identityListingHostUserId,
  });

  const recipientActor = recipientActorFrom(post);
  if (!recipientActor) {
    return {
      ...post,
      ownerName: ownerProj.mode === 'full' ? ownerProj.displayName || post.ownerName : null,
      ownerHandle: ownerProj.shareHandle,
      ownerAvatarUrl: ownerProj.avatarUrl,
      ownerVerificationLevel: ownerProj.mode === 'full' ? post.ownerVerificationLevel : 0,
      ownerProfileNavigableFromPost: ownerProj.profileNavigableFromPost,
      recipientProfileNavigableFromPost: true,
    };
  }

  const recPolicy = policyFor(identities, recipientActor.userId);
  const recProj = projectActorIdentityForViewer(recipientActor, recPolicy.exposure, {
    viewerUserId: viewerId,
    viewerFollowsActor: viewerId ? followed.has(recipientActor.userId) : false,
    isCounterparty: Boolean(viewerId && viewerId === post.ownerId),
    hideFromCounterparty: recPolicy.hideFromCounterparty,
    actorSurfaceVisibility: recPolicy.surfaceVisibility,
    counterpartyUserId: post.ownerId,
    identityListingHostUserId,
  });

  return {
    ...post,
    ownerName: ownerProj.mode === 'full' ? ownerProj.displayName || post.ownerName : null,
    ownerHandle: ownerProj.shareHandle,
    ownerAvatarUrl: ownerProj.avatarUrl,
    ownerVerificationLevel: ownerProj.mode === 'full' ? post.ownerVerificationLevel : 0,
    ownerProfileNavigableFromPost: ownerProj.profileNavigableFromPost,
    recipientUser: {
      ...recipientActor,
      displayName: recProj.mode === 'full' ? recProj.displayName : '',
      shareHandle: recProj.shareHandle,
      avatarUrl: recProj.avatarUrl,
      verificationLevel: recProj.mode === 'full' ? post.recipientUser?.verificationLevel : 0,
    },
    recipientProfileNavigableFromPost: recProj.profileNavigableFromPost,
  };
}

export async function applyPostActorIdentityProjectionBatch(
  client: SupabaseClient<Database>,
  posts: PostWithOwner[],
  viewerId: string | null,
  opts?: ApplyPostActorIdentityProjectionOptions,
): Promise<PostWithOwner[]> {
  if (posts.length === 0) return posts;

  const targets: string[] = [];
  for (const p of posts) {
    targets.push(p.ownerId);
    const rid = p.recipientUser?.userId ?? p.recipient?.recipientUserId;
    if (rid) targets.push(rid);
  }

  // These two reads are independent — `targets` is derived from `posts` in
  // memory, not from the identity rows — so run them in parallel to avoid a
  // request waterfall on every feed page / post / search load.
  const [identityByPost, followed] = await Promise.all([
    opts?.prefetchedIdentities
      ?? fetchPostActorIdentitiesByPostIds(
        client,
        posts.map((p) => p.postId),
      ),
    viewerId
      ? fetchFollowedTargets(client, viewerId, targets)
      : Promise.resolve(new Set<string>()),
  ]);

  const listingHost = opts?.identityListingHostUserId ?? null;

  return posts.map((post) =>
    projectSingle(post, viewerId, identityByPost.get(post.postId) ?? new Map(), followed, listingHost),
  );
}
