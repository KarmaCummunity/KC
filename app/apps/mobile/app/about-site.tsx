import React from 'react';
import { AboutLandingScreen } from '../src/features/about-landing/AboutLandingScreen';

export { RouteErrorBoundary as ErrorBoundary } from '../src/components/RouteErrorBoundary';

/** Marketing / web deep link alias for the full About landing (`/about` is identical). */
export default function AboutSiteRoute() {
  return <AboutLandingScreen />;
}
