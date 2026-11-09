import React from 'react';
import { WorldDedicatedLinksScreen } from '../../../../src/components/giving/WorldDedicatedLinksScreen';
import { WorldLaunchGateByFlag } from '../../../../src/components/worlds/WorldLaunchGate';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function TimeLinksScreen() {
  return (
    <WorldLaunchGateByFlag flagKey="world_time_enabled">
      <WorldDedicatedLinksScreen worldSlug="time" categorySlug="time" />
    </WorldLaunchGateByFlag>
  );
}
