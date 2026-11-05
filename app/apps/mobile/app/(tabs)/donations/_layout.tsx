// Donations tab — Stack within the tab so Hub / Money / Time / Category share back-nav.
// Mapped to: FR-DONATE-001..009 / D-16.
import { Stack } from 'expo-router';
import { useTheme } from '@kc/ui';
import { nativeStackHeaderLeftIconOnly } from '../../../src/navigation/nativeHeaderIconOnly';
import { nestedStackGestureOptions } from '../../../src/navigation/nestedStackGestureOptions';
import { topBarStackHeader } from '../../../src/navigation/TopBarStackHeader';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

export default function DonationsLayout() {
  const { colors } = useTheme();
  const detailHeader = {
    headerShown: true,
    ...nativeStackHeaderLeftIconOnly(colors.primary),
    headerBackVisible: false,
    headerTintColor: colors.primary,
    headerStyle: { backgroundColor: colors.background },
    // #1632: the app TopBar (KC logo) stays on every screen inside Donations.
    header: topBarStackHeader,
  } as const;
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
      <Stack.Screen name="money" options={{ headerShown: false }} />
      <Stack.Screen name="time" options={{ headerShown: false }} />
      <Stack.Screen name="items" options={{ headerShown: false }} />
      <Stack.Screen name="food" options={{ headerShown: false }} />
      <Stack.Screen name="housing" options={{ headerShown: false }} />
      <Stack.Screen name="animals" options={{ headerShown: false }} />
      <Stack.Screen name="category/[slug]" options={{ ...detailHeader, headerTitle: '' }} />
      <Stack.Screen name="rides" options={{ headerShown: false }} />
      <Stack.Screen name="knowledge" options={{ headerShown: false }} />
      <Stack.Screen name="marketplace" options={{ headerShown: false }} />
      <Stack.Screen name="challenges" options={{ headerShown: false }} />
    </Stack>
  );
}
