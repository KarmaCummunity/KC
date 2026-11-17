// app/apps/mobile/app/(admin)/org-jobs/index.tsx
// §5.11 (#1476) — platform admins allow an organization to publish job offers, after checking it
// may legally employ people, until the verification levels record that. Karma Community always
// may. The server re-checks the role on every write and audits it.
import React, { useCallback } from 'react';
import { Platform, ScrollView } from 'react-native';
import { hasPermission, type AdminRole } from '@kc/domain';
import { makeUseStyles, spacing, Text, typography } from '@kc/ui';
import { OrgJobPostingList } from '../../../src/components/admin/OrgJobPostingList';
import { useAdminScreenTitle } from '../../../src/components/admin/useAdminScreenTitle';
import { useAdminRoles } from '../../../src/hooks/useAdminRoles';
import { useOrgJobPostingAdmin } from '../../../src/hooks/useOrgJobPostingAdmin';
import { useLocaleBundle } from '../../../src/i18n/useLocaleBundle';
export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

/** One-line notice (window.alert on web). */
function notify(message: string): void {
  if (Platform.OS === 'web' && typeof window !== 'undefined') window.alert(message);
}

export default function AdminOrgJobsScreen() {
  const styles = useStyles();
  const t = useLocaleBundle().admin.orgJobs;
  const { roles, isLoading: rolesLoading } = useAdminRoles();
  const canSwitch = hasPermission(roles as readonly AdminRole[], 'org.job_posting');
  const admin = useOrgJobPostingAdmin(!rolesLoading);

  useAdminScreenTitle(t.title);

  const onSwitch = useCallback(
    (orgId: string, mayPostJobs: boolean) => {
      void admin.setMayPostJobs(orgId, mayPostJobs).then((ok) => {
        if (!ok) notify(t.saveError);
      });
    },
    [admin, t.saveError],
  );

  if (rolesLoading || admin.loading) return <Text style={styles.message}>{t.loading}</Text>;
  if (admin.failed) return <Text style={styles.message}>{t.loadError}</Text>;

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Text style={styles.hint}>{canSwitch ? t.hint : t.readOnly}</Text>
      {admin.organizations.length === 0 ? <Text style={styles.message}>{t.empty}</Text> : null}
      <OrgJobPostingList
        organizations={admin.organizations}
        canSwitch={canSwitch}
        busyOrgId={admin.busyOrgId}
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
