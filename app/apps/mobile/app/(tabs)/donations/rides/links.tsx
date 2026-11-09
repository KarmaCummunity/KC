import React from 'react';
import { WorldDedicatedLinksScreen } from '../../../../src/components/giving/WorldDedicatedLinksScreen';
import { WorldLaunchGateByFlag } from '../../../../src/components/worlds/WorldLaunchGate';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function RidesLinksScreen() {
  return (
    <WorldLaunchGateByFlag flagKey="world_rides_enabled">
      <WorldDedicatedLinksScreen worldSlug="rides" categorySlug="transport" />
    </WorldLaunchGateByFlag>
  );
}
