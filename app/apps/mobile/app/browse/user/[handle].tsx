import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { GuestProfileScreen } from '../../../src/screens/guest/GuestProfileScreen';
export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';
export default function GuestUserRoute() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  return <GuestProfileScreen handle={typeof handle === 'string' ? handle : ''} />;
}
