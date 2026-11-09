import React from 'react';
import { WorldMarketplaceHub } from '../../../../src/components/giving/WorldMarketplaceHub';
import { WORLD_CHROME_BY_SLUG } from '../../../../src/components/giving/worldChromeRegistry';
import { WorldLaunchGateBySlug } from '../../../../src/components/worlds/WorldLaunchGate';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function KnowledgeHubScreen() {
  return (
    <WorldLaunchGateBySlug worldSlug="knowledge">
      <WorldMarketplaceHub
        worldSlug="knowledge"
        icon="school-outline"
        introKey="donations.knowledge.hubBody"
        linksCategory="knowledge"
        subScreens={WORLD_CHROME_BY_SLUG.knowledge.subScreens}
      />
    </WorldLaunchGateBySlug>
  );
}
