import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Screen } from '../../../../src/components/ui/Screen';
import { MapExplorer } from '../../../../src/components/map/MapExplorer';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function MarketplaceMapScreen() {
  const { world } = useLocalSearchParams<{ world?: string }>();
  return (
    <Screen scroll={false} blobs="off" tabBarInset={false}>
      <MapExplorer initialWorld={typeof world === 'string' && world ? world : null} />
    </Screen>
  );
}
