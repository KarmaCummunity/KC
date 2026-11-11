import React from 'react';
import { WorldMarketplaceHub } from '../../../../src/components/giving/WorldMarketplaceHub';
import { WORLD_CHROME_BY_SLUG } from '../../../../src/components/giving/worldChromeRegistry';
import { WorldLaunchGateBySlug } from '../../../../src/components/worlds/WorldLaunchGate';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function FoodWorldScreen() {
  return (
    <WorldLaunchGateBySlug worldSlug="food">
      <WorldMarketplaceHub
        worldSlug="food"
        icon="restaurant-outline"
        introKey="givingHandoff.foodHubIntro"
        linksCategory="food"
        subScreens={WORLD_CHROME_BY_SLUG.food.subScreens}
      />
    </WorldLaunchGateBySlug>
  );
}
