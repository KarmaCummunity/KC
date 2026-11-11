// Maps a challenge to its feed post (0639) for share, menu and likes/comments on the detail screen.
import { useQuery } from '@tanstack/react-query';
import { getLegacySupabaseClient } from '@kc/infrastructure-supabase';
import type { PostWithOwner } from '@kc/application';
import { getPostByIdUseCase } from '../services/postsComposition';
import { pickAuthStorage } from '../services/authSecureStorage';

async function resolveChallengePostId(challengeId: string): Promise<string | null> {
  const client = getLegacySupabaseClient({ storage: pickAuthStorage() });
  const { data, error } = await client
    .from('posts')
    .select('post_id')
    .eq('post_type', 'challenge')
    .filter('details->>challenge_id', 'eq', challengeId)
    .maybeSingle();
  if (error) throw error;
  return data?.post_id ?? null;
}

export function useChallengeLinkedPost(
  challengeId: string | undefined,
  viewerId: string | null,
): { postId: string | null; post: PostWithOwner | null; isLoading: boolean } {
  const postIdQuery = useQuery({
    queryKey: ['challenge', 'postId', challengeId],
    queryFn: () => resolveChallengePostId(challengeId!),
    enabled: Boolean(challengeId),
    staleTime: 300_000,
  });

  const postQuery = useQuery({
    queryKey: ['post', postIdQuery.data, viewerId, 'challenge-detail'],
    queryFn: () =>
      getPostByIdUseCase().execute({
        postId: postIdQuery.data!,
        viewerId,
        identityListingHostUserId: null,
      }),
    enabled: Boolean(postIdQuery.data),
    staleTime: 60_000,
  });

  return {
    postId: postIdQuery.data ?? null,
    post: postQuery.data?.post ?? null,
    isLoading: postIdQuery.isLoading || (Boolean(postIdQuery.data) && postQuery.isLoading),
  };
}
