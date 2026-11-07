// FR-ADMIN-031 — Demo data: shows how much kc-dev fake data exists and lets a super admin
// delete it in one press (admin_wipe_demo_data, 0591) and bring it back (admin_seed_demo_data, 0592).
import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hasPermission, type AdminRole } from '@kc/domain';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { useTranslation } from 'react-i18next';
import { useAdminRoles } from '../../../src/hooks/useAdminRoles';
import { getDemoDataRepository } from '../../../src/services/demoDataComposition';
import { confirmAction } from '../../../src/services/platformConfirm';
import { demoDataErrorKey } from '../../../src/lib/demoDataRpcError';
import { AdminListEmpty } from '../../../src/components/admin/AdminListEmpty';
import { DemoDataSeedCard } from '../../../src/components/admin/demoData/DemoDataSeedCard';
import { useLocaleBundle } from '../../../src/i18n/useLocaleBundle';
import { useAdminScreenTitle } from '../../../src/components/admin/useAdminScreenTitle';
import { textAlignStart } from '../../../src/lib/rtlLayout';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

const STATUS_KEY = ['admin.demoData.status'] as const;

export default function DemoDataScreen() {
  const styles = useStyles();
  const L = useLocaleBundle();
  const t = L.admin.demoData;
  const { t: i18nT } = useTranslation();
  const queryClient = useQueryClient();
  const { roles, isLoading: rolesLoading } = useAdminRoles();
  const enabled = hasPermission(roles as readonly AdminRole[], 'demo_data.manage');

  useAdminScreenTitle(t.title);
  const [wipeProgress, setWipeProgress] = useState<string | null>(null);
  const [seedProgress, setSeedProgress] = useState<string | null>(null);

  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => getDemoDataRepository().getStatus(),
    enabled,
    staleTime: 30_000,
  });

  const alertRpcError = (err: unknown) => {
    const message = err instanceof Error ? err.message : '';
    const key = demoDataErrorKey(message);
    Alert.alert(t.title, i18nT(key));
  };

  const wipe = useMutation({
    mutationFn: () => getDemoDataRepository().wipe((key) => setWipeProgress(key)),
    onSuccess: (r) => {
      void queryClient.invalidateQueries();
      void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
      const kept = r.organizationsKept > 0 ? `\n${t.orgsKept(r.organizationsKept)}` : '';
      Alert.alert(t.doneTitle, `${t.done(r.usersDeleted, r.organizationsDeleted)}${kept}`);
    },
    onError: alertRpcError,
    onSettled: () => {
      setWipeProgress(null);
      void status.refetch();
    },
  });

  const seed = useMutation({
    mutationFn: (password: string | undefined) =>
      getDemoDataRepository().seed(password, (key) => setSeedProgress(key)),
    onSuccess: (r) => {
      void queryClient.invalidateQueries();
      void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
      Alert.alert(t.seedDoneTitle, t.seedDone(r.users, r.posts, r.organizations));
    },
    onError: alertRpcError,
    onSettled: () => {
      setSeedProgress(null);
      void status.refetch();
    },
  });

  if (rolesLoading) {
    return <View style={styles.center}><Text>{t.loading}</Text></View>;
  }
  const refused = status.isError && /forbidden/i.test(status.error.message);
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

      {status.isError && !refused ? (
        <Text style={styles.error}>{i18nT(demoDataErrorKey(status.error.message))}</Text>
      ) : null}

      {status.isSuccess && !hasDemo ? (
        <AdminListEmpty title={t.noneTitle} hint={canSeed ? t.noneHintRestore : t.noneHintNoRestore} />
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
            testID="admin-demo-wipe"
          >
            <Text style={styles.wipeLabel}>
              {wipe.isPending ? (wipeProgress ? t.wipeProgress(wipeProgress) : t.wiping) : t.wipeButton}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {status.isSuccess && canSeed ? (
        <>
          {hasDemo ? <Text style={styles.muted}>{t.seedWhileDemoExistsHint}</Text> : null}
          <DemoDataSeedCard
            needsPassword={!status.data?.hasSavedPassword}
            pending={seed.isPending}
            progressLabel={seedProgress ? t.seedProgress(seedProgress) : null}
            onSeed={(password) => seed.mutate(password)}
          />
        </>
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
