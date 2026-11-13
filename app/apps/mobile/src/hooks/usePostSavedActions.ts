// FR-POST-022 — save/unsave toggle for PostMenuSheet (#895 optimistic).
import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getIsPostSavedUseCase,
  getSavePostUseCase,
  getUnsavePostUseCase,
} from '../services/savedPostsComposition';
import { useAuthStore } from '../store/authStore';
import { useFeedSessionStore } from '../store/feedSessionStore';
import { hapticLightImpact } from '../lib/haptics';

interface PostSavedActionsOptions {
  /**
   * When false the saved-state lookup is not sent. Feed and profile grids render one
   * menu button per card, so the lookup must wait until the menu is actually opened;
   * otherwise every rendered card costs its own request. Defaults to true.
   */
  readonly enabled?: boolean;
}

export function usePostSavedActions(postId: string, options: PostSavedActionsOptions = {}) {
  const { enabled = true } = options;
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const savedKey = ['post-saved', postId, userId] as const;

  const savedQuery = useQuery({
    queryKey: savedKey,
    queryFn: () => getIsPostSavedUseCase().execute(postId),
    enabled: enabled && Boolean(userId),
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['post-saved', postId] });
    if (userId) {
      void queryClient.invalidateQueries({ queryKey: ['saved-posts', userId] });
    }
  }, [postId, queryClient, userId]);

  const toast = useFeedSessionStore.getState().showEphemeralToast;

  const saveMutation = useMutation({
    mutationFn: () => getSavePostUseCase().execute(postId),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: savedKey });
      const prev = queryClient.getQueryData<boolean>(savedKey);
      queryClient.setQueryData(savedKey, true);
      return { prev };
    },
    onSuccess: () => {
      hapticLightImpact();
      toast(t('post.saveSuccess'), 'success');
      invalidate();
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev !== undefined) queryClient.setQueryData(savedKey, ctx.prev);
      toast(t('post.saveError'), 'error', 2800);
    },
  });

  const unsaveMutation = useMutation({
    mutationFn: () => getUnsavePostUseCase().execute(postId),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: savedKey });
      const prev = queryClient.getQueryData<boolean>(savedKey);
      queryClient.setQueryData(savedKey, false);
      return { prev };
    },
    onSuccess: () => {
      toast(t('post.unsaveSuccess'), 'success');
      invalidate();
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev !== undefined) queryClient.setQueryData(savedKey, ctx.prev);
      toast(t('post.unsaveError'), 'error', 2800);
    },
  });

  const isSaved = savedQuery.data === true;
  const busy = saveMutation.isPending || unsaveMutation.isPending;

  const toggleSave = useCallback(() => {
    if (busy) return;
    if (isSaved) unsaveMutation.mutate();
    else saveMutation.mutate();
  }, [busy, isSaved, saveMutation, unsaveMutation]);

  return {
    isSaved,
    isLoading: savedQuery.isLoading,
    busy,
    toggleSave,
  };
}
