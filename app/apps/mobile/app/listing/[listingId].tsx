import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { MarketplaceListingRoute } from '../../src/screens/marketplace/MarketplaceListingRoute';
import { useShellTabBarScrollInset } from '../../src/navigation/useShellTabBarVisibility';

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';

export default function RootMarketplaceListingDetailRoute() {
  const { listingId } = useLocalSearchParams<{ listingId: string }>();
  const inset = useShellTabBarScrollInset();

  return <MarketplaceListingRoute listingId={listingId} bottomInset={inset} />;
}
