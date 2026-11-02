import React from 'react';
import { WorldGivingHub } from '../../../../src/components/giving/WorldGivingHub';
import { WorldLaunchGateBySlug } from '../../../../src/components/worlds/WorldLaunchGate';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function FoodWorldScreen() {
  return (
    <WorldLaunchGateBySlug worldSlug="food">
      <WorldGivingHub
        worldSlug="food"
        icon="restaurant-outline"
        introKey="givingHandoff.foodHubIntro"
        handoffsPath="/(tabs)/donations/food/handoffs"
      />
    </WorldLaunchGateBySlug>
  );
}
