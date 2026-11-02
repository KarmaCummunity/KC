import { Stack } from 'expo-router';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function MarketplaceLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
