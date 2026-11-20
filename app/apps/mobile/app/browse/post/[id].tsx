import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { GuestBrowseScreen } from '../../../src/screens/guest/GuestBrowseScreen';
export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';
export default function GuestPostRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <GuestBrowseScreen postId={typeof id === 'string' ? id : ''} />;
}
