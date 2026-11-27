import type { ReactNode } from 'react';
import { View } from 'react-native';
import { makeUseStyles, spacing, Text } from '@kc/ui';
import { SilentUnauthorizedFallback } from '../permissions/SilentUnauthorizedFallback';

export interface AdminScreenGuardProps {
  readonly isLoading:    boolean;
  readonly allowed:      boolean;
  readonly loadingLabel: string;
  readonly children:     ReactNode;
}

export function AdminScreenGuard({
  isLoading, allowed, loadingLabel, children,
}: AdminScreenGuardProps) {
  const styles = useStyles();
  if (isLoading) {
    return <View style={styles.center}><Text>{loadingLabel}</Text></View>;
  }
  if (!allowed) {
    return <SilentUnauthorizedFallback href="/(admin)" />;
  }
  return <>{children}</>;
}

const useStyles = makeUseStyles(() => ({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
}));
