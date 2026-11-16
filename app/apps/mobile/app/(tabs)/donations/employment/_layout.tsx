// Employment world stack (FR-FEED-020 AC2, #2278): the world screen and its links sub-screen.
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { nestedStackGestureOptions } from '../../../../src/navigation/nestedStackGestureOptions';
import { topBarStackHeaderOptions } from '../../../../src/navigation/TopBarStackHeader';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function EmploymentWorldLayout() {
  const { t } = useTranslation();
  return (
    <Stack screenOptions={{ ...nestedStackGestureOptions, ...topBarStackHeaderOptions, headerBackTitle: t('general.back') }}>
      <Stack.Screen name="index" options={{ headerTitle: t('donations.categories.employment.title') }} />
    </Stack>
  );
}
