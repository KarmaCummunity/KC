// FR-ADMIN-031 — Demo data: whether the kc-dev demo data is shown or hidden, how much of it
// exists, "Hide demo data" behind a confirmation (a wipe), and "Show demo data" (a restore).
// Both are stepped (one short RPC per phase) and show the phase that runs. The tools exist only
// on kc-dev (supabase/seed/demo, installed by every dev deploy); where they are missing or out
// of date the screen says which, and which environment this build is connected to.
import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hasDemoData, hasPermission, isDemoDataError, type AdminRole } from '@kc/domain';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { container } from '../../../src/lib/container';
import { getAppEnvironment } from '../../../src/config/environment';
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
  // The two refusals that mean "no usable tools here": the screen explains them in full.
  const unavailable = refusal === 'notInstalled' || refusal === 'outdated' ? refusal : null;
  const busy = wipe.isPending || seed.isPending;
  const shown = status.data ? hasDemoData(status.data) : false;

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

        {unavailable ? (
          <>
            <AdminListEmpty
              title={unavailable === 'outdated' ? t.outdatedTitle : t.notInstalledTitle}
              hint={unavailable === 'outdated' ? t.outdatedHint : t.notInstalledHint}
            />
            {/* A production-wired build never has the tools; saying so ends the guessing. */}
            <Text style={styles.environment} testID="admin-demo-environment">{t.connectedTo[getAppEnvironment()]}</Text>
          </>
        ) : null}
        {refusal && !unavailable ? <Text style={styles.error}>{t.errors[refusal]}</Text> : null}

        {status.data ? (
          <Text style={[styles.state, shown ? styles.stateShown : null]} testID="admin-demo-state">
            {shown ? t.stateShown : t.stateHidden}
          </Text>
        ) : null}

        {status.data && !shown ? (
          <AdminListEmpty title={t.noneTitle} hint={status.data.canSeed ? t.noneHintRestore : t.noneHintNoRestore} />
        ) : null}

        {status.data && shown ? (
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
            {shown ? <Text style={styles.muted}>{t.seedWhileDemoExistsHint}</Text> : null}
            <DemoDataSeedCard
              label={shown ? t.refreshButton : t.seedButton}
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
  environment: { color: colors.textSecondary, fontSize: typography.bodySmall.fontSize, textAlign: 'center' },
  state: { color: colors.textSecondary, fontSize: typography.bodyLarge.fontSize, ...typography.semiBold, textAlign: textAlignStart() },
  stateShown: { color: colors.textPrimary },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, gap: spacing.md,
  },
}));
