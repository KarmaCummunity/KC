import React from 'react';
import { WorldDedicatedLinksScreen } from '../../../../src/components/giving/WorldDedicatedLinksScreen';
import { WorldLaunchGateBySlug } from '../../../../src/components/worlds/WorldLaunchGate';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function KnowledgeLinksScreen() {
  return (
    <WorldLaunchGateBySlug worldSlug="knowledge">
      <WorldDedicatedLinksScreen worldSlug="knowledge" />
    </WorldLaunchGateBySlug>
  );
}
