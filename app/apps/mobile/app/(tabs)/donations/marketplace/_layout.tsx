import { Stack } from 'expo-router';
import { nestedStackGestureOptions } from '../../../../src/navigation/nestedStackGestureOptions';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function MarketplaceLayout() {
  return <Stack screenOptions={{ ...nestedStackGestureOptions, headerShown: false }} />;
}
