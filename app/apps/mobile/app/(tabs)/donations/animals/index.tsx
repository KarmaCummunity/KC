// Mapped to spec: FR-FEED-020 AC2 / AC3 — the animals world screen: request / offer, search, and
// the world's feed of animals to give away or adopt and of boarding / pet-sitting offers and
// requests. While the animals launch flag is off the world stays a portal (curated links, D60).
import React from 'react';
import { WorldMarketplaceHub } from '../../../../src/components/giving/WorldMarketplaceHub';
import { worldSubScreens } from '../../../../src/components/giving/worldSubScreens';
import { WorldLaunchGateBySlug } from '../../../../src/components/worlds/WorldLaunchGate';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function AnimalsWorldScreen() {
  return (
    <WorldLaunchGateBySlug worldSlug="animals">
      <WorldMarketplaceHub
        worldSlug="animals"
        icon="paw-outline"
        introKey="donations.worldFeed.animalsIntro"
        linksCategory="animals"
        subScreens={worldSubScreens('/(tabs)/donations/animals/handoffs')}
      />
    </WorldLaunchGateBySlug>
  );
}
