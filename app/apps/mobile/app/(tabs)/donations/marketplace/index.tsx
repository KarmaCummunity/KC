// The "donations marketplace" browse screen was removed (FR-DONATE-001 AC6): listings are
// found in the main feed and in each giving world's screen. Old links and shared URLs to
// /donations/marketplace land on the donations hub instead of an unmatched route.
// Listing detail (`[listingId]`), map and "my listings" stay under this segment.
import React from 'react';
import { Redirect } from 'expo-router';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function MarketplaceIndexRedirect() {
  return <Redirect href="/(tabs)/donations" />;
}
