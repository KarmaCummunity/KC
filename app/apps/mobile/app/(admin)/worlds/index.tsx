// app/apps/mobile/app/(admin)/worlds/index.tsx
// #2277 (FR-ADMIN-034) — the super admin switches each giving world between portal (links and
// knowledge) and active (feed, posts, create form). The switch writes this environment's launch
// flag, so the dev app switches kc-dev and the production app switches production. Staff who may
// open the portal see the modes read-only; the server re-checks the role on every write.
import React, { useCallback } from 'react';
import { Platform, ScrollView } from 'react-native';
import { hasPermission, type AdminRole, type LaunchWorldFlagKey, type WorldLaunchMode } from '@kc/domain';
import { makeUseStyles, spacing, Text, typography } from '@kc/ui';
import { WorldLaunchSwitchList } from '../../../src/components/admin/WorldLaunchSwitchList';
import { useAdminScreenTitle } from '../../../src/components/admin/useAdminScreenTitle';
import { useAdminRoles } from '../../../src/hooks/useAdminRoles';
import { useWorldLaunchAdmin } from '../../../src/hooks/useWorldLaunchAdmin';
import { useLocaleBundle } from '../../../src/i18n/useLocaleBundle';
export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

/** One-line notice (window.alert on web). */
function notify(message: string): void {
  if (Platform.OS === 'web' && typeof window !== 'undefined') window.alert(message);
}

export default function AdminWorldsScreen() {
  const styles = useStyles();
  const t = useLocaleBundle().admin.worlds;
  const { roles, isLoading: rolesLoading } = useAdminRoles();
  const canSwitch = hasPermission(roles as readonly AdminRole[], 'worlds.launch');
  const admin = useWorldLaunchAdmin();

  useAdminScreenTitle(t.title);

  const onSwitch = useCallback(
    (flagKey: LaunchWorldFlagKey, mode: WorldLaunchMode) => {
      void admin.setMode(flagKey, mode).then((ok) => {
        if (!ok) notify(t.saveError);
      });
    },
    [admin, t.saveError],
  );

  if (rolesLoading || !admin.loaded) return <Text style={styles.message}>{t.loading}</Text>;

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Text style={styles.hint}>{canSwitch ? t.hint : t.readOnly}</Text>
      <WorldLaunchSwitchList
        worlds={admin.worlds}
        canSwitch={canSwitch}
        busyKey={admin.busyKey}
        onSwitch={onSwitch}
        strings={t}
      />
    </ScrollView>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  body: { padding: spacing.lg, gap: spacing.md },
  hint: { ...typography.caption, color: colors.textSecondary },
  message: { ...typography.body, color: colors.textSecondary, padding: spacing.lg },
}));
