// FR-ADMIN-031 — Demo data: shows how much kc-dev fake data exists and lets a super admin
// delete it in one press (admin_wipe_demo_data, 0591) and bring it back (admin_seed_demo_data, 0592).
import { Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hasPermission, type AdminRole } from '@kc/domain';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { useAdminRoles } from '../../../src/hooks/useAdminRoles';
import { getDemoDataRepository } from '../../../src/services/demoDataComposition';
import { confirmAction } from '../../../src/services/platformConfirm';
import { AdminListEmpty } from '../../../src/components/admin/AdminListEmpty';
import { DemoDataSeedCard } from '../../../src/components/admin/demoData/DemoDataSeedCard';
import { useLocaleBundle } from '../../../src/i18n/useLocaleBundle';
import { textAlignStart } from '../../../src/lib/rtlLayout';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

const STATUS_KEY = ['admin.demoData.status'] as const;

export default function DemoDataScreen() {
  const styles = useStyles();
  const L = useLocaleBundle();
  const t = L.admin.demoData;
  const queryClient = useQueryClient();
  const { roles, isLoading: rolesLoading } = useAdminRoles();
  const enabled = hasPermission(roles as readonly AdminRole[], 'demo_data.manage');

  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => getDemoDataRepository().getStatus(),
    enabled,
    staleTime: 30_000,
  });

  const wipe = useMutation({
    mutationFn: () => getDemoDataRepository().wipe(),
    onSuccess: (r) => {
      // Real data changed under every list in the app, so drop all cached queries.
      void queryClient.invalidateQueries();
      const kept = r.organizationsKept > 0 ? `\n${t.orgsKept(r.organizationsKept)}` : '';
      Alert.alert(t.doneTitle, `${t.done(r.usersDeleted, r.organizationsDeleted)}${kept}`);
    },
    onError: () => Alert.alert(t.wipeFailed),
  });

  const seed = useMutation({
    mutationFn: (password: string | undefined) => getDemoDataRepository().seed(password),
    onSuccess: (r) => {
      void queryClient.invalidateQueries();
      Alert.alert(t.seedDoneTitle, t.seedDone(r.users, r.posts, r.organizations));
    },
    onError: () => Alert.alert(t.seedFailed),
  });

  if (rolesLoading) {
    return <View style={styles.center}><Text>{t.loading}</Text></View>;
  }
  // The client gate is coarse (every org_admin passes); the server refuses org admins outside the platform org.
  const refused = status.isError && /forbidden/.test(status.error.message);
  if (!enabled || refused) {
    return <View style={styles.center}><Text style={styles.forbidden}>{t.forbiddenTitle}</Text></View>;
  }

  const users = status.data?.demoUsers ?? 0;
  const orgs = status.data?.demoOrganizations ?? 0;
  const hasDemo = users + orgs > 0;
  const canSeed = status.data?.canSeed ?? false;

  const onWipe = async () => {
    const ok = await confirmAction(t.confirmTitle, t.confirmBody(users, orgs), {
      confirmLabel: t.confirmOk, cancelLabel: t.confirmCancel, destructive: true,
    });
    if (ok) wipe.mutate();
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={status.isFetching} onRefresh={() => { void status.refetch(); }} />}
    >
      <Text style={styles.title}>{t.title}</Text>
      <Text style={styles.muted}>{t.subtitle}</Text>

      {status.isError ? <Text style={styles.error}>{t.error}</Text> : null}
      {status.isSuccess && !hasDemo ? (
        <AdminListEmpty title={t.noneTitle} hint={canSeed ? t.noneHintRestore : t.noneHintNoRestore} />
      ) : null}
      {status.isSuccess && !hasDemo && canSeed ? (
        <DemoDataSeedCard
          needsPassword={!status.data?.hasSavedPassword}
          pending={seed.isPending}
          onSeed={(password) => seed.mutate(password)}
        />
      ) : null}

      {status.isSuccess && hasDemo ? (
        <View style={styles.card}>
          <View style={styles.kpiRow}>
            <Kpi label={t.users} value={users} />
            <Kpi label={t.organizations} value={orgs} />
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={wipe.isPending}
            onPress={() => { void onWipe(); }}
            style={[styles.wipeButton, wipe.isPending && styles.wipeButtonDisabled]}
          >
            <Text style={styles.wipeLabel}>{wipe.isPending ? t.wiping : t.wipeButton}</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  const styles = useStyles();
  return (
    <View style={styles.kpi}>
      <Text style={styles.kpiValue}>{String(value)}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.base, paddingBottom: spacing['2xl'], gap: spacing.sm, width: '100%', maxWidth: 900, alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  forbidden: { color: colors.error, textAlign: 'center' },
  title: { fontSize: typography.h2.fontSize, ...typography.bold, color: colors.textPrimary, textAlign: textAlignStart() },
  muted: { color: colors.textSecondary, fontSize: typography.bodySmall.fontSize, textAlign: textAlignStart() },
  error: { color: colors.error, fontSize: typography.bodySmall.fontSize, textAlign: textAlignStart() },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: spacing.md,
  },
  kpiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  kpi: {
    flexGrow: 1, flexBasis: 140, minWidth: 120, backgroundColor: colors.background, borderRadius: radius.sm, padding: spacing.sm,
    borderWidth: 1, borderColor: colors.border, gap: spacing.xs,
  },
  kpiValue: { fontSize: typography.h3.fontSize, ...typography.extraBold, color: colors.textPrimary, textAlign: textAlignStart() },
  kpiLabel: { fontSize: typography.bodySmall.fontSize, ...typography.semiBold, color: colors.textSecondary, textAlign: textAlignStart() },
  wipeButton: { backgroundColor: colors.error, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  wipeButtonDisabled: { opacity: 0.5 },
  wipeLabel: { color: colors.textInverse, fontSize: typography.body.fontSize, ...typography.bold },
}));
