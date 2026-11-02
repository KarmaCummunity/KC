import { Stack } from 'expo-router';
import { useTheme } from '@kc/ui';

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';

export default function AuthLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.surface },
      }}
    />
  );
}
