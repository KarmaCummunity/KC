import type { ReactNode } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ConfigErrorScreen } from './ConfigErrorScreen';

interface ConfigGateProps {
  /** Whether the build-time public Supabase env is present (see `isSupabaseConfigured`). */
  configured: boolean;
  children: ReactNode;
}

/**
 * Renders the app only when the build carries its public backend config.
 * Otherwise paints `ConfigErrorScreen` on a minimal tree: the full app tree
 * touches the Supabase placeholder client, which throws and closed the Android
 * process before anything was visible (#1944).
 */
export function ConfigGate({ configured, children }: Readonly<ConfigGateProps>) {
  if (configured) return <>{children}</>;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ConfigErrorScreen />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
