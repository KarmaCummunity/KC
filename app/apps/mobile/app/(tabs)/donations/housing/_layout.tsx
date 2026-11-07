// Housing world stack (FR-FEED-020 AC2): the world screen and its sub-screens.
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { nestedStackGestureOptions } from '../../../../src/navigation/nestedStackGestureOptions';
import { topBarStackHeaderOptions } from '../../../../src/navigation/TopBarStackHeader';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function HousingWorldLayout() {
  const { t } = useTranslation();
  return (
    <Stack screenOptions={{ ...nestedStackGestureOptions, ...topBarStackHeaderOptions, headerBackTitle: t('general.back'), }}>
      <Stack.Screen name="index" options={{ headerTitle: t('donations.categories.housing.title') }} />
      <Stack.Screen name="handoffs" options={{ headerTitle: t('givingHandoff.myHandoffs') }} />
    </Stack>
  );
}
