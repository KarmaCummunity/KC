// D45 / D62 — the experiences giving world (spec 05.8, phase 2). Until its
// in-app flow exists it opens as a portal (D60).
import React from 'react';
import { WorldPortalScreen } from '../../../../src/components/worlds/WorldPortalScreen';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function ExperiencesWorldScreen() {
  return <WorldPortalScreen />;
}
