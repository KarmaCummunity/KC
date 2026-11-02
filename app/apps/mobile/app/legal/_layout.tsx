import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useDetailStackScreenOptions } from '../../src/navigation/detailStackScreenOptions';

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';

export default function LegalLayout() {
  const { t } = useTranslation();
  const detailStackScreenOptions = useDetailStackScreenOptions();
  return (
    <Stack screenOptions={{ ...detailStackScreenOptions, headerBackTitle: '' }}>
      <Stack.Screen name="terms" options={{ title: t('legal.termsTitle') }} />
      <Stack.Screen name="privacy" options={{ title: t('legal.privacyTitle') }} />
    </Stack>
  );
}
