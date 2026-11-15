// FR-POST-023 — what kind of thing a shared post is. The share text and the link-preview card both
// speak per kind, so a ride is never announced as "an item waiting for a new home".
// Pure: no React, no i18n. The edge twin of this mapping is web-edge/src/ogCard.mjs.

import type { Post } from '@kc/domain';

/** Worlds that have their own share wording; every other world shares the `generic` wording. */
export const SHARE_WORLDS = [
  'items',
  'food',
  'rides',
  'time',
  'housing',
  'animals',
  'knowledge',
  'challenges',
  'generic',
] as const;
export type ShareWorld = (typeof SHARE_WORLDS)[number];

/** An offer is a `Give` post, a request is a `Request` post (docs/spec/94 glossary). */
export type ShareDirection = 'offer' | 'request';

/** Only `closed_delivered` posts are shareable once closed (FR-POST-023 AC1). */
export type ShareLifecycle = 'open' | 'closed';

export interface PostShareKind {
  readonly world: ShareWorld;
  readonly direction: ShareDirection;
  readonly lifecycle: ShareLifecycle;
}

type ShareKindSource = Pick<Post, 'type' | 'status' | 'listingWorldSlug' | 'challengeId'>;

/** Worlds with their own wording (`generic` is the fallback, never a real world slug). */
const OWN_WORDING = new Set<string>(SHARE_WORLDS.filter((w) => w !== 'generic'));

/**
 * The share world of a post. A challenge opens its own screen, so it wins; a post without a world
 * slug is a plain item post; a world without its own wording (money, medical, ...) is `generic`.
 */
export function resolveShareWorld(post: Pick<Post, 'listingWorldSlug' | 'challengeId'>): ShareWorld {
  if (post.challengeId) return 'challenges';
  const slug = post.listingWorldSlug;
  if (!slug) return 'items';
  return OWN_WORDING.has(slug) ? (slug as ShareWorld) : 'generic';
}

export function resolvePostShareKind(post: ShareKindSource): PostShareKind {
  return {
    world: resolveShareWorld(post),
    direction: post.type === 'Request' ? 'request' : 'offer',
    lifecycle: post.status === 'closed_delivered' ? 'closed' : 'open',
  };
}
