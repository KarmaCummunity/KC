// FR-ADMIN-031 — Demo data: how much kc-dev demo data exists, "Delete all demo data" behind a
// confirmation, and "Restore demo data". Wipe and restore are stepped (one short RPC per phase)
// and show the phase that runs. The tools exist only on kc-dev (supabase/seed/demo); anywhere
// else the screen says they are not installed.
import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hasDemoData, hasPermission, isDemoDataError, type AdminRole } from '@kc/domain';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { container } from '../../../src/lib/container';
import { useAdminRoles } from '../../../src/hooks/useAdminRoles';
import { confirmAction } from '../../../src/services/platformConfirm';
import { demoDataErrorKey } from '../../../src/lib/admin/demoDataErrorKey';
import { AdminListEmpty } from '../../../src/components/admin/AdminListEmpty';
import { AdminScreenGuard } from '../../../src/components/admin/AdminScreenGuard';
import { DemoDataKpis } from '../../../src/components/admin/demoData/DemoDataKpis';
import { DemoDataSeedCard } from '../../../src/components/admin/demoData/DemoDataSeedCard';
import { DangerButton } from '../../../src/components/ui';
import { useLocaleBundle } from '../../../src/i18n/useLocaleBundle';
import { useAdminScreenTitle } from '../../../src/components/admin/useAdminScreenTitle';
import { textAlignStart } from '../../../src/lib/rtlLayout';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

const STATUS_KEY = ['admin.demoData.status'] as const;

export default function DemoDataScreen() {
  const styles = useStyles();
  const t = useLocaleBundle().admin.demoData;
  const queryClient = useQueryClient();
  const { roles, isLoading: rolesLoading } = useAdminRoles();
  const enabled = hasPermission(roles as readonly AdminRole[], 'demo_data.manage');
  useAdminScreenTitle(t.title);

  const [progress, setProgress] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const progressLabel = progress ? (t.progress[progress as keyof typeof t.progress] ?? null) : null;

  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => container.getDemoDataStatus.execute(),
    enabled,
    staleTime: 30_000,
    // A refusal (not installed, forbidden) does not change by asking again.
    retry: (count, err) => !isDemoDataError(err) && count < 2,
  });

  // After a wipe or a restore every cached list (feed, chats, profiles) may be stale.
  const settle = () => {
    setProgress(null);
    void queryClient.invalidateQueries();
  };
  const onError = (err: unknown) => setFailure(t.errors[demoDataErrorKey(err)]);

  const wipe = useMutation({
    mutationFn: () => container.wipeDemoData.execute(setProgress),
    onSuccess: (r) => {
      const kept = r.organizationsKept > 0 ? ` ${t.orgsKept(r.organizationsKept)}` : '';
      setNotice(`${t.doneTitle}: ${t.done(r.usersDeleted, r.organizationsDeleted)}${kept}`);
    },
    onError,
    onSettled: settle,
  });

  const seed = useMutation({
    mutationFn: (password: string | undefined) => container.restoreDemoData.execute(password, setProgress),
    onSuccess: (r) => setNotice(`${t.seedDoneTitle}: ${t.seedDone(r.users, r.itemPosts, r.ridePosts, r.organizations)}`),
    onError,
    onSettled: settle,
  });

  const refusal = status.isError ? demoDataErrorKey(status.error) : null;
  const busy = wipe.isPending || seed.isPending;

  const onWipe = async () => {
    const data = status.data;
    if (!data) return;
    const ok = await confirmAction(t.confirmTitle, t.confirmBody(data.demoUsers, data.demoOrganizations), {
      confirmLabel: t.confirmOk, cancelLabel: t.confirmCancel, destructive: true,
    });
    if (!ok) return;
    setNotice(null);
    setFailure(null);
    wipe.mutate();
  };
  const onSeed = (password: string | undefined) => {
    setNotice(null);
    setFailure(null);
    seed.mutate(password);
  };

  return (
    <AdminScreenGuard
      isLoading={rolesLoading}
      allowed={enabled && refusal !== 'forbidden'}
      loadingLabel={t.loading}
      forbiddenLabel={t.forbiddenTitle}
    >
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={status.isFetching} onRefresh={() => { void status.refetch(); }} />}
      >
        <Text style={styles.title}>{t.title}</Text>
        <Text style={styles.muted}>{t.subtitle}</Text>
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {failure ? <Text style={styles.error}>{failure}</Text> : null}

        {refusal === 'notInstalled' ? <AdminListEmpty title={t.notInstalledTitle} hint={t.notInstalledHint} /> : null}
        {refusal && refusal !== 'notInstalled' ? <Text style={styles.error}>{t.errors[refusal]}</Text> : null}

        {status.data && !hasDemoData(status.data) ? (
          <AdminListEmpty title={t.noneTitle} hint={status.data.canSeed ? t.noneHintRestore : t.noneHintNoRestore} />
        ) : null}

        {status.data && hasDemoData(status.data) ? (
          <View style={styles.card}>
            <DemoDataKpis status={status.data} />
            <DangerButton
              label={wipe.isPending ? (progressLabel ?? t.wiping) : t.wipeButton}
              onPress={() => { void onWipe(); }}
              disabled={busy}
              fullWidth
              testID="admin-demo-wipe"
            />
          </View>
        ) : null}

        {status.data?.canSeed ? (
          <>
            {hasDemoData(status.data) ? <Text style={styles.muted}>{t.seedWhileDemoExistsHint}</Text> : null}
            <DemoDataSeedCard
              needsPassword={!status.data.hasSavedPassword}
              pending={seed.isPending}
              progressLabel={seed.isPending ? progressLabel : null}
              onSeed={onSeed}
            />
          </>
        ) : null}
      </ScrollView>
    </AdminScreenGuard>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root: { flex: 1, backgroundColor: colors.background },
  content: {
    padding: spacing.base, paddingBottom: spacing['2xl'], gap: spacing.sm, width: '100%', maxWidth: 900, alignSelf: 'center',
  },
  title: { fontSize: typography.h2.fontSize, ...typography.bold, color: colors.textPrimary, textAlign: textAlignStart() },
  muted: { color: colors.textSecondary, fontSize: typography.bodySmall.fontSize, textAlign: textAlignStart() },
  notice: { color: colors.success, fontSize: typography.body.fontSize, ...typography.semiBold, textAlign: textAlignStart() },
  error: { color: colors.error, fontSize: typography.bodySmall.fontSize, textAlign: textAlignStart() },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, gap: spacing.md,
  },
}));
