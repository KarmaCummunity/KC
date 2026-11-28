// Refresh the listing editor's readers before returning to a mounted search screen.
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { postActorIdentityQueryKey } from './useListingExposure';

export function useListingEditSaved(id: string | undefined, listingId: string | null | undefined) {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useCallback(async () => {
    const keys = [
      ['post', id], ['feed'], ['my-posts'], ['my-hidden-open-posts'],
      ['profile-tab-open-count'], ['universalSearch'],
      ...(listingId ? [['marketplace', 'detail', listingId], postActorIdentityQueryKey(listingId)] : []),
    ];
    await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    router.back();
  }, [queryClient, id, listingId, router]);
}
