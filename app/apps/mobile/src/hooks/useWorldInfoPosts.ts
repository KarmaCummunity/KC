// Mapped to spec: FR-KNOW-* / FR-DONATE-007 — the knowledge ("info") posts shown beside a giving
// world's community links. They come from the knowledge world's feed (the same query the world
// feed uses, so visibility, blocking and status rules are inherited), narrowed to the subject of
// the links screen's own category by a locale-provided keyword. The knowledge world itself shows
// all of its posts. Search and sort are applied client-side by `worldLinksCatalog`.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PostWithOwner } from '@kc/application';
import { getFeedUseCase } from '../services/postsComposition';
import { useAuthStore } from '../store/authStore';
import { worldFeedFilter, worldPostFilterDefaults } from '../lib/worldPostFeed';

/** The world whose posts are "knowledge" posts. */
export const KNOWLEDGE_WORLD_SLUG = 'knowledge';

/** One page is enough for a side section; the full list is one tap away in the knowledge world. */
const INFO_POSTS_LIMIT = 30;

/**
 * @param subjectKeyword Locale keyword of the links screen's subject (e.g. "animals"); empty for
 *                       the knowledge world, which shows every knowledge post.
 */
export function useWorldInfoPosts(subjectKeyword: string) {
  const viewerId = useAuthStore((s) => s.session?.userId ?? null);
  const filter = useMemo(
    () => worldFeedFilter(KNOWLEDGE_WORLD_SLUG, {
      ...worldPostFilterDefaults(KNOWLEDGE_WORLD_SLUG),
      searchQuery: subjectKeyword,
    }),
    [subjectKeyword],
  );

  const query = useQuery({
    queryKey: ['world-info-posts', viewerId, filter],
    queryFn: () => getFeedUseCase().execute({ viewerId, filter, limit: INFO_POSTS_LIMIT }),
    staleTime: 60_000,
  });

  const posts: PostWithOwner[] = query.data?.posts ?? [];
  return { posts, isLoading: query.isLoading, isError: query.isError, refetch: () => void query.refetch() };
}
