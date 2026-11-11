import React from 'react';
import { WorldDedicatedLinksScreen } from '../../../../src/components/giving/WorldDedicatedLinksScreen';
import { WorldLaunchGateBySlug } from '../../../../src/components/worlds/WorldLaunchGate';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function HousingLinksScreen() {
  return (
    <WorldLaunchGateBySlug worldSlug="housing">
      <WorldDedicatedLinksScreen worldSlug="housing" categorySlug="housing" />
    </WorldLaunchGateBySlug>
  );
}
