// Maps a challenge to its feed post for share, menu and likes/comments on the detail screen.
// The challenge summary names its post (supabase/schemas/74_challenges, `challenge_summary`).
import { useQuery } from '@tanstack/react-query';
import type { PostWithOwner } from '@kc/application';
import { getPostByIdUseCase } from '../services/postsComposition';
import { challengeUseCases } from '../services/challengeComposition';

async function resolveChallengePostId(challengeId: string): Promise<string | null> {
  const challenge = await challengeUseCases.get().execute(challengeId);
  return challenge?.postId ?? null;
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
