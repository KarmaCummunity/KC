// FR-RIDE-002 — rides hub route.
import React from 'react';
import { RidesHubScreen } from '../../../../src/features/rides/screens/RidesHubScreen';
import { WorldLaunchGateByFlag } from '../../../../src/components/worlds/WorldLaunchGate';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function RidesHubRoute() {
  return (
    <WorldLaunchGateByFlag flagKey="world_rides_enabled">
      <RidesHubScreen />
    </WorldLaunchGateByFlag>
  );
}
