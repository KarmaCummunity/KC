import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function ItemsWorldLayout() {
  const { t } = useTranslation();
  return (
    <Stack screenOptions={{ headerShown: true, headerBackTitle: t('general.back') }}>
      <Stack.Screen name="index" options={{ headerTitle: t('donations.items.title') }} />
      <Stack.Screen name="handoffs" options={{ headerTitle: t('givingHandoff.myHandoffs') }} />
    </Stack>
  );
}
