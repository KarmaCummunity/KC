// Retired legacy ride list (D70): a person's rides are their listings on the one rides flow.
import { Redirect } from 'expo-router';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function LegacyRidesListRedirect() {
  return <Redirect href="/(tabs)/donations/marketplace/my-listings" />;
}
