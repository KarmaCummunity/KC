// Listing-world post detail: the same close steps as a social post, bound to this offer.
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { Post } from '@kc/domain';
import { useFeedSessionStore } from '../../store/feedSessionStore';
import { listingOfferAllowsCloseWithout, listingOwnerMarkCtaKey } from '../../lib/listingOwnerClosure';
import { OwnerActionsBar } from './OwnerActionsBar';

interface Props {
  readonly post: Post;
  readonly ownerId: string;
  readonly tabBarOverlayInset?: number;
  readonly embedded?: boolean;
}

export function ListingOwnerClosureBar({ post, ownerId, tabBarOverlayInset = 0, embedded = false }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const world = post.listingWorldSlug;

  const leaveIfClosed = (outcome?: 'closed' | 'assigned') => {
    const key = outcome === 'assigned' ? 'closure.assignSuccessToast' : 'closure.detailCloseSuccessToast';
    useFeedSessionStore.getState().showEphemeralToast(t(key), 'success', 2200);
    if (outcome === 'assigned') return;
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

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
