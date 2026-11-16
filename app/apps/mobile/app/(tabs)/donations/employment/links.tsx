// The employment world's "links and knowledge" sub-screen (#1963, #2278).
import React from 'react';
import { WorldDedicatedLinksScreen } from '../../../../src/components/giving/WorldDedicatedLinksScreen';
import { WorldLaunchGateBySlug } from '../../../../src/components/worlds/WorldLaunchGate';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function EmploymentLinksScreen() {
  return (
    <WorldLaunchGateBySlug worldSlug="employment">
      <WorldDedicatedLinksScreen worldSlug="employment" />
    </WorldLaunchGateBySlug>
  );
}
