// Listing-world post detail: the same close steps as a social post, bound to this offer. An
// organization's event ends instead (EventOwnerCloseBar): nobody "receives" an event (G18).
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { Post } from '@kc/domain';
import { ORG_EVENT_KIND_SLUG, parseEventPostDetails } from '@kc/domain';
import { useFeedSessionStore } from '../../store/feedSessionStore';
import { useMarketplaceListingDetail } from '../../hooks/useMarketplaceListingDetail';
import { listingOfferAllowsCloseWithout, listingOwnerMarkCtaKey } from '../../lib/listingOwnerClosure';
import { EventOwnerCloseBar } from './EventOwnerCloseBar';
import { OwnerActionsBar } from './OwnerActionsBar';

interface Props {
  readonly post: Post;
  /** The offer's listing; its detail (already loaded by the screen) tells whether it is an event. */
  readonly listingId: string;
  readonly ownerId: string;
  readonly tabBarOverlayInset?: number;
  readonly embedded?: boolean;
}

export function ListingOwnerClosureBar({ post, listingId, ownerId, tabBarOverlayInset = 0, embedded = false }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const world = post.listingWorldSlug;
  const detail = useMarketplaceListingDetail(listingId).data;
  const event = detail?.kindSlug === ORG_EVENT_KIND_SLUG ? parseEventPostDetails(detail.details) : null;

  const leaveIfClosed = (outcome?: 'closed' | 'assigned') => {
    const key = outcome === 'assigned' ? 'closure.assignSuccessToast' : 'closure.detailCloseSuccessToast';
    useFeedSessionStore.getState().showEphemeralToast(t(key), 'success', 2200);
    if (outcome === 'assigned') return;
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  if (event) return <EventOwnerCloseBar listingId={listingId} startsAt={event.startsAt} />;

  return (
    <OwnerActionsBar
      post={post}
      ownerId={ownerId}
      tabBarOverlayInset={tabBarOverlayInset}
      embedded={embedded}
      markCtaKey={listingOwnerMarkCtaKey(world)}
      offerAssign
      allowCloseWithout={listingOfferAllowsCloseWithout(world)}
      onClosed={leaveIfClosed}
      onReopened={() => leaveIfClosed('closed')}
    />
  );
}
