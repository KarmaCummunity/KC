import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { MarketplaceListingDetailScreen } from '../../../../src/screens/marketplace/MarketplaceListingDetailScreen';
import { useShellTabBarScrollInset } from '../../../../src/navigation/useShellTabBarVisibility';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function TabMarketplaceListingDetailRoute() {
  const { listingId } = useLocalSearchParams<{ listingId: string }>();
  const inset = useShellTabBarScrollInset();

  return <MarketplaceListingDetailScreen listingId={listingId} bottomInset={inset} />;
}
