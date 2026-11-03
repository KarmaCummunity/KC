// Rides stack within Donations tab — FR-RIDE-001.
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useWorldStackOptions } from '../../../../src/navigation/worldStackOptions';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function RidesLayout() {
  const { t } = useTranslation();
  const { detailHeader, screenOptions } = useWorldStackOptions();
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={{ ...detailHeader, headerTitle: t('donations.categories.transport.title') }} />
      <Stack.Screen name="[id]" options={{ ...detailHeader, headerTitle: t('donations.rides.detailTitle') }} />
      <Stack.Screen name="handoffs" options={{ ...detailHeader, headerTitle: t('givingHandoff.myHandoffs') }} />
      <Stack.Screen name="series" options={{ ...detailHeader, headerTitle: t('rideSeries.mine') }} />
    </Stack>
  );
}
