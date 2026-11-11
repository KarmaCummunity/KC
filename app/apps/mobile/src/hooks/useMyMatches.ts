// "Matches for you" (matching v2, 0420–0423): the caller's pairs + accept/decline.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { getMatchRepository } from '../services/matchingComposition';

export const myMatchesQueryKey = (userId: string | null | undefined) => ['my-matches', userId ?? null] as const;

export function useMyMatches(limit = 20) {
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  return useQuery({
    queryKey: [...myMatchesQueryKey(userId), limit],
    queryFn: () => getMatchRepository().listMine(limit),
    enabled: Boolean(userId),
    staleTime: 60_000,
  });
}

export function useRespondToMatch() {
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { candidateId: string; response: 'accept' | 'decline' }) =>
      getMatchRepository().respond(v.candidateId, v.response),
    onSuccess: () => qc.invalidateQueries({ queryKey: myMatchesQueryKey(userId) }),
  });
}
