// The challenges world's "links and knowledge" screen; the layout gates the whole world (D60).
import React from 'react';
import { WorldDedicatedLinksScreen } from '../../../../src/components/giving/WorldDedicatedLinksScreen';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function ChallengesLinksScreen() {
  return <WorldDedicatedLinksScreen worldSlug="challenges" />;
}
