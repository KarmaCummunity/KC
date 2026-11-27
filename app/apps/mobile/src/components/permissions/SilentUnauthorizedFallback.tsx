// Last-resort fallback when a permission-gated route is opened without access.
// Redirects back silently (or to a safe href if the stack is empty). Never
// shows a no-permission / lock empty state — those actions must be hidden first.
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';
import { makeUseStyles, spacing } from '@kc/ui';

export interface SilentUnauthorizedFallbackProps {
  /** Used only when the navigation stack cannot go back. Member routes use tabs; staff tools use the portal home. */
  readonly href?: '/(tabs)' | '/(admin)';
}

export function SilentUnauthorizedFallback({ href = '/(tabs)' }: SilentUnauthorizedFallbackProps) {
  const router = useRouter();
  const styles = useStyles();

  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace(href);
  }, [href, router]);

  return (
    <View style={styles.center} testID="silent-unauthorized-fallback" accessibilityElementsHidden>
      <ActivityIndicator />
    </View>
  );
}

const useStyles = makeUseStyles(() => ({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
}));
