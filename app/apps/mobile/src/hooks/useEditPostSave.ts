// FR-POST-008 / FR-POST-009 / FR-POST-015 AC1: the edit form's save. Split out of
// `app/edit-post/[id].tsx` so the screen stays under the 300-line cap (#1752); behavior is unchanged.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { Post } from '@kc/domain';
import { isPostError } from '@kc/application';
import { getUpdatePostUseCase } from '../services/postsComposition';
import { mapPostErrorToHebrew } from '../services/postMessages';
import { syncOwnerPostActorIdentity } from '../lib/syncOwnerPostActorIdentity';
import type { EditPostForm } from './useEditPostForm';

type PostPatch = Parameters<ReturnType<typeof getUpdatePostUseCase>['execute']>[0]['patch'];

/**
 * The patch a save sends. Condition belongs to an offer and urgency to a request, so each is
 * cleared on the other kind; an empty description or urgency is stored as null.
 */
export function buildEditPostPatch(form: EditPostForm, isGive: boolean): PostPatch {
  const city = form.city;
  if (!city) throw new Error('city_required');
  return {
    title: form.title,
    description: form.description.trim() ? form.description.trim() : null,
    category: form.category,
    address: { city: city.id, cityName: city.name, street: form.street, streetNumber: form.streetNumber },
    locationDisplayLevel: form.locationDisplayLevel,
    itemCondition: isGive ? form.condition : null,
    urgency: !isGive && form.urgency.trim() ? form.urgency.trim() : null,
    visibility: form.visibility,
    mediaAssets: form.uploads.map((u) => ({ path: u.path, mimeType: u.mimeType, sizeBytes: u.sizeBytes })),
  };
}

/** Query keys a saved edit can change: the post itself and every list or count that shows it. */
const QUERY_KEYS_AFTER_EDIT = (postId: string, viewerId: string | null): readonly (readonly unknown[])[] => [
  ['post', postId, viewerId],
  ['post-actor-identity', postId],
  ['my-posts'],
  ['my-hidden-open-posts'],
  ['profile-closed-posts'],
  ['profile-tab-open-count'],
  ['profile-tab-closed-count'],
  ['feed'],
];

interface Params {
  readonly postId: string | undefined;
  readonly viewerId: string | null;
  readonly post: Pick<Post, 'type' | 'ownerId'> | null | undefined;
  readonly form: EditPostForm;
  /** The owner's "hide my identity from the counterparty" choice, saved with the post (FR-POST-015 AC1). */
  readonly hideFromCounterparty: boolean;
  /** Shows a failed save to the member. */
  readonly onFailure: (notice: { title: string; message: string }) => void;
}

/** Saves the edit, then refreshes what it changed and leaves the screen. */
export function useEditPostSave({ postId, viewerId, post, form, hideFromCounterparty, onFailure }: Params) {
  const router = useRouter();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!viewerId || !postId) throw new Error('not_authenticated');
      const patch = buildEditPostPatch(form, post?.type === 'Give');
      const updated = await getUpdatePostUseCase().execute({ postId, viewerId, patch });
      // Only the owner has an actor identity row to keep in step with the post's visibility.
      if (post?.ownerId === viewerId) {
        await syncOwnerPostActorIdentity({ postId, ownerId: viewerId, visibility: form.visibility, hideFromCounterparty });
      }
      return updated;
    },
    onSuccess: async () => {
      for (const queryKey of QUERY_KEYS_AFTER_EDIT(postId ?? '', viewerId)) {
        await queryClient.invalidateQueries({ queryKey: [...queryKey] });
      }
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)');
    },
    onError: (err) => {
      const message = isPostError(err) ? mapPostErrorToHebrew(err.code) : t('post.editPost.networkError');
      onFailure({ title: t('post.editPost.saveFailedTitle'), message });
    },
  });
}
