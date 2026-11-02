import React from 'react';
import { AboutLandingScreen } from '../src/features/about-landing/AboutLandingScreen';

export { RouteErrorBoundary as ErrorBoundary } from '../src/components/RouteErrorBoundary';

export default function AboutRoute() {
  return <AboutLandingScreen />;
}
