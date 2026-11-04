// G1 step 4a (ADR-006) — what a listing route renders: the post's detail when the listing has a
// post (forwarded there, the one detail screen), otherwise the listing detail itself. Only the
// routes use this; the post detail embeds MarketplaceListingDetailScreen directly, so the two
// never bounce between each other.
import React from 'react';
import { ActivityIndicator } from 'react-native';
import { spacing } from '@kc/ui';
import { Screen } from '../../components/ui/Screen';
import { useMarketplaceListingDetail } from '../../hooks/useMarketplaceListingDetail';
import { useListingPostRedirect } from '../../hooks/useListingPostRedirect';
import { MarketplaceListingDetailScreen } from './MarketplaceListingDetailScreen';

type Props = {
  readonly listingId: string | undefined;
  readonly bottomInset?: number;
};

export function MarketplaceListingRoute({ listingId, bottomInset = 0 }: Props) {
  // Same query key as the screen below, so the detail is fetched once.
  const { data: detail } = useMarketplaceListingDetail(listingId);
  const forwardingToPost = useListingPostRedirect(detail);

  if (forwardingToPost) {
    return (
      <Screen>
        <ActivityIndicator style={{ marginTop: spacing.xl }} />
      </Screen>
    );
  }
  return <MarketplaceListingDetailScreen listingId={listingId} bottomInset={bottomInset} />;
}
