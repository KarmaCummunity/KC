import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { nestedStackGestureOptions } from '../../../../src/navigation/nestedStackGestureOptions';
import { topBarStackHeaderOptions } from '../../../../src/navigation/TopBarStackHeader';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function ItemsWorldLayout() {
  const { t } = useTranslation();
  return (
    <Stack screenOptions={{ ...nestedStackGestureOptions, ...topBarStackHeaderOptions, headerBackTitle: t('general.back'), }}>
      <Stack.Screen name="index" options={{ headerTitle: t('donations.items.title') }} />
      <Stack.Screen name="handoffs" options={{ headerTitle: t('givingHandoff.myHandoffs') }} />
    </Stack>
  );
}
