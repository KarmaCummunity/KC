// Knowledge world stack within Donations tab.
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useWorldStackOptions } from '../../../../src/navigation/worldStackOptions';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function KnowledgeLayout() {
  const { t } = useTranslation();
  const { detailHeader, screenOptions } = useWorldStackOptions();
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={{ ...detailHeader, headerTitle: t('donations.categories.knowledge.title') }} />
      <Stack.Screen name="handoffs" options={{ ...detailHeader, headerTitle: t('givingHandoff.myHandoffs') }} />
    </Stack>
  );
}
