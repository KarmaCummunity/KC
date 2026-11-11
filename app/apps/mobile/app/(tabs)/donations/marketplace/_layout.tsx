import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { nestedStackGestureOptions } from '../../../../src/navigation/nestedStackGestureOptions';
import { topBarStackHeaderOptions } from '../../../../src/navigation/TopBarStackHeader';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function MarketplaceLayout() {
  const { t } = useTranslation();
  return (
    <Stack
      screenOptions={{
        ...nestedStackGestureOptions,
        ...topBarStackHeaderOptions,
        headerBackTitle: t('general.back'),
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="map" options={{ headerTitle: t('feed.openMapA11y') }} />
      <Stack.Screen name="[listingId]" options={{ headerTitle: '' }} />
      <Stack.Screen name="my-listings" options={{ headerTitle: t('marketplace.myListingsTitle') }} />
      <Stack.Screen
        name="my-listings/edit/[listingId]"
        options={{ headerTitle: t('marketplace.myListingsEdit') }}
      />
    </Stack>
  );
}
