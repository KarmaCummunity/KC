// Donations tab — Stack within the tab so Hub / Money / Time / Category share back-nav.
// Mapped to: FR-DONATE-001..009 / D-16.
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@kc/ui';
import { nativeStackHeaderLeftIconOnly } from '../../../src/navigation/nativeHeaderIconOnly';
import { nestedStackGestureOptions } from '../../../src/navigation/nestedStackGestureOptions';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

export default function DonationsLayout() {
  const { colors } = useTheme();
  const detailHeader = {
    headerShown: true,
    ...nativeStackHeaderLeftIconOnly(colors.primary),
    headerBackVisible: false,
    headerTintColor: colors.primary,
    headerStyle: { backgroundColor: colors.background },
  } as const;
  const { t } = useTranslation();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: {
          backgroundColor: colors.background,
          flex: 1,
          width: '100%',
          minWidth: '100%',
          alignSelf: 'stretch',
        },
        ...nestedStackGestureOptions,
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="money" options={{ ...detailHeader, headerTitle: t('donations.moneyScreen.title') }} />
      <Stack.Screen name="time" options={{ headerShown: false }} />
      <Stack.Screen name="items" options={{ headerShown: false }} />
      <Stack.Screen name="food" options={{ headerShown: false }} />
      <Stack.Screen name="housing" options={{ headerShown: false }} />
      <Stack.Screen name="category/[slug]" options={{ ...detailHeader, headerTitle: '' }} />
      <Stack.Screen name="domain/[slug]" options={{ ...detailHeader, headerTitle: '' }} />
      <Stack.Screen name="experiences" options={{ ...detailHeader, headerTitle: '' }} />
      <Stack.Screen name="rides" options={{ headerShown: false }} />
      <Stack.Screen name="knowledge" options={{ headerShown: false }} />
      <Stack.Screen name="marketplace" options={{ headerShown: false }} />
    </Stack>
  );
}
