// Mapped to spec: FR-FEED-020 AC2 / AC3 — the housing world screen: request / offer, search,
// and the world's feed of open hosting offers and stay requests. While the housing launch flag
// is off the world stays a portal (curated links, D60).
import React from 'react';
import { WorldMarketplaceHub } from '../../../../src/components/giving/WorldMarketplaceHub';
import { worldSubScreens } from '../../../../src/components/giving/worldSubScreens';
import { WorldLaunchGateBySlug } from '../../../../src/components/worlds/WorldLaunchGate';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function HousingWorldScreen() {
  return (
    <WorldLaunchGateBySlug worldSlug="housing">
      <WorldMarketplaceHub
        worldSlug="housing"
        icon="home-outline"
        introKey="donations.worldFeed.housingIntro"
        linksCategory="housing"
        subScreens={worldSubScreens('/(tabs)/donations/housing/handoffs', [
          { labelKey: 'housingStay.myHosting.nav', path: '/(tabs)/donations/housing/hosting', testID: 'world-hub-housing-hosting' },
          { labelKey: 'housingStay.myStays.nav', path: '/(tabs)/donations/housing/stays', testID: 'world-hub-housing-stays' },
        ])}
      />
    </WorldLaunchGateBySlug>
  );
}
