import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMemo, useRef, useState } from 'react';
import type {
  Category,
  ItemCondition,
  LocationDisplayLevel,
  PostType,
  PostVisibility,
} from '@kc/domain';
import { isPostError } from '@kc/application';
import { generateUuid } from '../lib/uuid';
import { useNetworkStatusStore } from '../lib/networkStatusStore';
import { useOutboxStore } from '../store/outboxStore';
import { getCreatePostUseCase, getPostRepo } from '../services/postsComposition';
import { useFeedSessionStore } from '../store/feedSessionStore';
import { useLastAddressStore } from '../store/lastAddressStore';
import { usePostDraftStore } from '../store/postDraftStore';
import {
  buildAddressInlineErrorMessage,
  buildCreatePostNonAddressToastMessage,
  getAddressValidationIssue,
  hasAddressRequiredFieldGaps,
  hasNonAddressRequiredFieldGaps,
} from '../lib/createPostFieldValidation';
import { mapPostErrorToHebrew } from '../services/postMessages';
import { invalidatePersonalStatsCaches } from '../lib/invalidatePersonalStatsCaches';
import { hapticSuccess } from '../lib/haptics';
import { invalidateMyProfilePostQueries } from '../lib/invalidateMyProfilePostQueries';
import { buildPostCreatePayload } from '../lib/unifiedCreate/unifiedCreatePayload';
import { trackActivationIfFirst, trackCoreLoop } from '../lib/analyticsCoreLoop';
import { useAuthStore } from '../store/authStore';
import { closeCreateForm } from '../navigation/closeCreateForm';
import type { UploadedAsset } from '../services/imageUpload';
import type { PrePromptTrigger } from '../lib/notifications/usePushPermissionGate';

export type CreatePostCitySelection = { id: string; name: string } | null;

export function useCreatePostPublish(args: {
  ownerId: string | undefined;
  type: PostType;
  title: string;
  description: string;
  category: Category;
  city: CreatePostCitySelection;
  street: string;
  streetNumber: string;
  locationDisplayLevel: LocationDisplayLevel;
  condition: ItemCondition;
  isGive: boolean;
  urgency: string;
  estimatedValue: number;
  uploads: UploadedAsset[];
  hideFromCounterparty: boolean;
  visibilityRef: { current: PostVisibility };
  setPublishFollowersOpen: (open: boolean) => void;
  requestSoftGate: (fn: () => void) => void;
  uploadingCount: number;
  presentPrePrompt: (trigger: PrePromptTrigger) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const checkedFirstPostRef = useRef(false);
  const prePublishOpenCountRef = useRef<number | null>(null);
  const publishStartedRef = useRef(false);
  const [addressValidationTouched, setAddressValidationTouched] = useState(false);

  const fieldSnapshot = useMemo(
    () => ({
      isGive: args.isGive,
      title: args.title,
      city: args.city,
      street: args.street,
      streetNumber: args.streetNumber,
      uploadsLength: args.uploads.length,
    }),
    [
      args.isGive,
      args.title,
      args.city,
      args.street,
      args.streetNumber,
      args.uploads.length,
    ],
  );

  const addressIssue = getAddressValidationIssue(
    args.city,
    args.street,
    args.streetNumber,
  );
  const addressInlineMessage =
    addressValidationTouched && addressIssue !== 'none'
      ? buildAddressInlineErrorMessage(addressIssue)
      : null;

  const publish = useMutation({
    mutationFn: async () => {
      const { ownerId } = args;
      if (!ownerId) throw new Error('not_authenticated');
      if (!args.city) throw new Error('city_required');
      if (!checkedFirstPostRef.current) {
        try {
          prePublishOpenCountRef.current = await getPostRepo().countOpenByUser(ownerId);
        } catch {
          // Non-critical — skip push gate on error.
        }
      }
      return getCreatePostUseCase().execute(
        buildPostCreatePayload({
          ...args,
          ownerId,
          city: args.city,
          visibility: args.visibilityRef.current,
        }),
      );
    },
    onSuccess: async () => {
      const { ownerId, city, street, streetNumber } = args;
      if (city) {
        useLastAddressStore.getState().setLastAddress({
          cityId: city.id,
          cityName: city.name,
          street,
          streetNumber,
        });
      }
      // FR-POST-007 AC4 — successful publish clears the local draft.
      usePostDraftStore.getState().clearDraft();
      // Core-loop funnel (#1055, #1042): items posts count like listings of the items world.
      const funnel = { world: 'items', cityId: city?.id ?? null };
      trackCoreLoop('listing_created', funnel);
      void trackActivationIfFirst({ ...funnel, accountCreatedAt: useAuthStore.getState().session?.accountCreatedAt });
      await queryClient.invalidateQueries({ queryKey: ['feed'] });
      invalidateMyProfilePostQueries(queryClient, ownerId);
      await queryClient.invalidateQueries({ queryKey: ['openPostsCount'] });
      invalidatePersonalStatsCaches(queryClient, ownerId);
      hapticSuccess();
      useFeedSessionStore.getState().showEphemeralToast(t('post.publishSuccess'), 'success');
      if (!checkedFirstPostRef.current && ownerId) {
        checkedFirstPostRef.current = true;
        if (prePublishOpenCountRef.current === 0) {
          void args.presentPrePrompt('first-post-published');
        }
      }
      closeCreateForm(router);
    },
    onError: (err) => {
      const message = isPostError(err) ? mapPostErrorToHebrew(err.code) : t('post.networkError');
      useFeedSessionStore.getState().showEphemeralToast(t('post.publishFailed', { message }), 'error');
    },
    onSettled: () => {
      publishStartedRef.current = false;
    },
  });

  const isPublishing = publish.isPending || args.uploadingCount > 0;

  const runPublishAfterGate = () => {
    args.requestSoftGate(() => {
      if (publishStartedRef.current) return;
      publishStartedRef.current = true;
      if (!useNetworkStatusStore.getState().isOnline) {
        const { ownerId, city, street, streetNumber } = args;
        if (!ownerId || !city) {
          publishStartedRef.current = false;
          return;
        }
        const postId = generateUuid();
        const payload = {
          ...buildPostCreatePayload({
            ...args,
            ownerId,
            city,
            visibility: args.visibilityRef.current,
          }),
          postId,
        };
        useOutboxStore.getState().enqueue({
          entityType: 'post',
          action: 'create_post',
          payload,
          idempotencyKey: `post:${postId}`,
        });
        useLastAddressStore.getState().setLastAddress({
          cityId: city.id,
          cityName: city.name,
          street,
          streetNumber,
        });
        usePostDraftStore.getState().clearDraft();
        useFeedSessionStore.getState().showEphemeralToast(t('offlineSync.postPending'), 'success');
        publishStartedRef.current = false;
        closeCreateForm(router);
        return;
      }
      publish.mutate();
    });
  };

  const tryPublish = () => {
    if (isPublishing) return;
    setAddressValidationTouched(true);

    const addressGap = hasAddressRequiredFieldGaps(
      args.city,
      args.street,
      args.streetNumber,
    );
    const nonAddressToast = buildCreatePostNonAddressToastMessage(fieldSnapshot);
    if (addressGap || hasNonAddressRequiredFieldGaps(fieldSnapshot)) {
      if (nonAddressToast.length > 0) {
        useFeedSessionStore.getState().showEphemeralToast(nonAddressToast, 'error', 2500);
      }
      return;
    }
    if (args.visibilityRef.current === 'FollowersOnly') {
      args.setPublishFollowersOpen(true);
      return;
    }
    runPublishAfterGate();
  };

  return {
    publish,
    tryPublish,
    runPublishAfterGate,
    isPublishing,
    addressInlineMessage,
  };
}
