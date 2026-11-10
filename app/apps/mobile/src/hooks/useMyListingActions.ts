// useMyListingActions — the owner actions of the "My listings" screen (spec 07 §7.1 "Owner
// management"): pause, resume, mark fulfilled, delete and add photos. The server enforces
// which action each status allows (migration 0543); a refusal is shown as an alert with the
// mapped message, never as an unhandled rejection or a raw server text.

import { useCallback, useMemo, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { marketplaceRepository } from '../services/marketplaceComposition';
import { pickListingImages, uploadListingImages } from '../services/listingImageUpload';
import { listingOwnerErrorKey } from '../lib/listingOwnerError';
import type { MyListingRow } from '@kc/domain';
import { useAuthStore } from '../store/authStore';
import { useClosureStore } from '../store/closureStore';
import { listingOfferAllowsCloseWithout } from '../lib/listingOwnerClosure';
import { useInvalidateMyListings } from './useMyMarketplaceListings';

/** Native confirm dialog (window.confirm on web); resolves true when the owner confirms. */
function confirmAsync(title: string, message: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' && window.confirm(`${title}\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'OK', onPress: () => resolve(true) },
    ]);
  });
}

/** Native alert (window.alert on web) with a title and a message. */
function notify(title: string, message: string): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.alert(`${title}\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

export interface MyListingActions {
  /** The listing whose action is running, so its row can disable its buttons. */
  readonly busyId: string | null;
  readonly pause: (listingId: string) => void;
  readonly resume: (listingId: string) => void;
  readonly fulfill: (listing: MyListingRow) => void;
  readonly remove: (listingId: string) => void;
  readonly addPhotos: (listingId: string) => void;
}

export function useMyListingActions(refetch: () => Promise<unknown>): MyListingActions {
  const { t } = useTranslation();
  const invalidate = useInvalidateMyListings();
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Runs one action for a row, refreshes the list, and explains a refusal.
  const run = useCallback(
    async (listingId: string, action: () => Promise<unknown>) => {
      setBusyId(listingId);
      try {
        await action();
        await invalidate();
        await refetch();
      } catch (error) {
        notify(t('marketplace.myListingsErrorTitle'), t(listingOwnerErrorKey(error)));
      } finally {
        setBusyId(null);
      }
    },
    [invalidate, refetch, t],
  );

  // Asks first, then runs; used for the actions that cannot be undone from the list.
  const confirmThenRun = useCallback(
    async (listingId: string, titleKey: string, hintKey: string, action: () => Promise<unknown>) => {
      if (await confirmAsync(t(titleKey), t(hintKey))) await run(listingId, action);
    },
    [run, t],
  );

  const pause = useCallback(
    (listingId: string) => void run(listingId, () => marketplaceRepository().pauseMyListing(listingId)),
    [run],
  );
  const resume = useCallback(
    (listingId: string) => void run(listingId, () => marketplaceRepository().resumeMyListing(listingId)),
    [run],
  );
  const fulfill = useCallback(
    (listing: MyListingRow) => {
      // Requests keep the listing close. Offers name a recipient on the post.
      if (listing.direction === 'request') {
        void confirmThenRun(
          listing.listingId,
          'marketplace.myListingsFulfillTitle',
          'marketplace.myListingsFulfillHint',
          () => marketplaceRepository().fulfillMyListing(listing.listingId),
        );
        return;
      }
      if (!listing.feedPostId || !userId) {
        notify(t('marketplace.myListingsErrorTitle'), t('marketplace.myListingsErrorNoPost'));
        return;
      }
      void useClosureStore.getState().start(listing.feedPostId, userId, 'Give', {
        initiator: 'my-listings',
        offerAssign: true,
        allowCloseWithout: listingOfferAllowsCloseWithout(listing.worldSlug),
        worldSlug: listing.worldSlug,
      });
    },
    [confirmThenRun, t, userId],
  );
  const remove = useCallback(
    (listingId: string) =>
      void confirmThenRun(listingId, 'marketplace.myListingsDeleteTitle', 'marketplace.myListingsDeleteHint', () =>
        marketplaceRepository().deleteMyListing(listingId),
      ),
    [confirmThenRun],
  );

  // Picks photos, uploads them under the owner's folder, then appends them to the listing.
  const addPhotos = useCallback(
    (listingId: string) => {
      if (!userId) return;
      void (async () => {
        const picked = await pickListingImages(0);
        if (picked.length === 0) return;
        await run(listingId, async () => {
          const paths = await uploadListingImages(userId, picked);
          await marketplaceRepository().addMyListingMedia(listingId, paths);
          notify(t('marketplace.myListingsAddPhotos'), t('marketplace.myListingsPhotosAdded'));
        });
      })();
    },
    [run, t, userId],
  );

  // Stable while nothing changes, so memoized list rows do not re-render on every parent render.
  return useMemo(
    () => ({ busyId, pause, resume, fulfill, remove, addPhotos }),
    [busyId, pause, resume, fulfill, remove, addPhotos],
  );
}
