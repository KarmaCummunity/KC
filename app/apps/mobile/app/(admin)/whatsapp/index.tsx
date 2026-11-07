// WhatsApp bot ops dashboard (#939) — consent, outbound, rate hits, matches, kill switch.
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hasPermission, isWhatsAppAdminError, type AdminPermission, type AdminRole } from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { DangerButton, PrimaryButton } from '../../../src/components/ui/Buttons';
import { useAdminRoles } from '../../../src/hooks/useAdminRoles';
import { container } from '../../../src/lib/container';
import { AdminFilterTopBarButton } from '../../../src/components/admin/AdminSearchFilterToolbar';
import { FilterSection } from '../../../src/components/filterKit/FilterSection';
import { AdminListEmpty } from '../../../src/components/admin/AdminListEmpty';
import { confirmAction as platformConfirm } from '../../../src/services/platformConfirm';
import { useLocaleBundle } from '../../../src/i18n/useLocaleBundle';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

type OutFilter = 'all' | 'queued' | 'sent' | 'failed';

export default function WhatsAppAdminScreen() {
  const styles = useStyles();
  const L = useLocaleBundle();
  const t = L.admin.whatsapp;
  const { roles, isLoading: rolesLoading } = useAdminRoles();
  const can = (perm: AdminPermission) => hasPermission(roles as readonly AdminRole[], perm);
  const queryClient = useQueryClient();
  const [outFilter, setOutFilter] = useState<OutFilter>('all');
  const [sheetOpen, setSheetOpen] = useState(false);

  const enabled = can('whatsapp.manage');
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin.whatsapp'] });
  };

  const overview = useQuery({
    queryKey: ['admin.whatsapp.overview'],
    queryFn: () => container.getWhatsAppAdminOverview.execute(),
    enabled,
    staleTime: 15_000,
  });
  const channel = useQuery({
    queryKey: ['admin.whatsapp.channel'],
    queryFn: () => container.getWhatsAppChannel.execute(),
    enabled,
    staleTime: 15_000,
  });
  const consent = useQuery({
    queryKey: ['admin.whatsapp.consent'],
    queryFn: () => container.listWhatsAppConsent.execute(50, 0),
    enabled,
    staleTime: 15_000,
  });
  const outbound = useQuery({
    queryKey: ['admin.whatsapp.outbound', outFilter],
    queryFn: () => container.listWhatsAppOutbound.execute({
      status: outFilter === 'all' ? undefined : outFilter,
      limit: 50,
    }),
    enabled,
    staleTime: 15_000,
  });
  const matches = useQuery({
    queryKey: ['admin.whatsapp.matches'],
    queryFn: () => container.listWhatsAppRecentMatches.execute(50),
    enabled,
    staleTime: 15_000,
  });
  const rateHits = useQuery({
    queryKey: ['admin.whatsapp.rateHits'],
    queryFn: () => container.listWhatsAppRateHits.execute(50),
    enabled,
    staleTime: 15_000,
  });
  const conversations = useQuery({
    queryKey: ['admin.whatsapp.conversations'],
    queryFn: () => container.listWhatsAppConversations.execute(50),
    enabled,
    staleTime: 15_000,
  });

  const setEnabled = useMutation({
    mutationFn: (on: boolean) => container.setWhatsAppChannelEnabled.execute(on),
    onSuccess: invalidate,
  });
  const resend = useMutation({
    mutationFn: (id: string) => container.resendWhatsAppOutbound.execute(id),
    onSuccess: invalidate,
  });
  const block = useMutation({
    mutationFn: (id: string) => container.blockWhatsAppUser.execute(id),
    onSuccess: invalidate,
  });

  const kpis = useMemo(() => {
    const o = overview.data;
    if (!o) return [];
    return [
      [t.overview.queued, o.outboundQueued],
      [t.overview.sent, o.outboundSent],
      [t.overview.failed, o.outboundFailed],
      [t.overview.skipped, o.outboundSkipped],
      [t.overview.consentIn, o.consentOptedIn],
      [t.overview.consentOut, o.consentOptedOut],
      [t.overview.sessions, o.sessions7d],
      [t.overview.matches, o.matchesSent7d],
      [t.overview.rateHits, o.rateHits7d],
    ] as const;
  }, [overview.data, t]);

  if (rolesLoading) {
    return <View style={styles.center}><Text>{t.loading}</Text></View>;
  }
  if (!enabled) {
    return <View style={styles.center}><Text style={styles.forbidden}>{t.forbiddenTitle}</Text></View>;
  }

  const refreshing = overview.isFetching || outbound.isFetching;
  const channelOn = channel.data?.isEnabled ?? false;

  const onToggle = async () => {
    const next = !channelOn;
    const ok = await platformConfirm(
      next ? t.killSwitch.confirmOnTitle : t.killSwitch.confirmOffTitle,
      next ? t.killSwitch.confirmOnBody : t.killSwitch.confirmOffBody,
      { confirmLabel: t.killSwitch.confirmOk, cancelLabel: t.killSwitch.cancel, destructive: !next },
    );
    if (ok) {
      try { await setEnabled.mutateAsync(next); }
      catch (e) { if (!isWhatsAppAdminError(e)) { /* ignore */ } }
    }
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={invalidate} />}
    >
      <Text style={styles.title}>{t.title}</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t.killSwitch.label}</Text>
        <Text style={styles.muted}>{channelOn ? t.killSwitch.on : t.killSwitch.off}</Text>
        {/* Turning the channel off is the destructive side of the switch (D94); compact admin size (§4.3). */}
        <View style={styles.btn}>
          {channelOn ? (
            <DangerButton testID="whatsapp-kill-switch" label={t.killSwitch.toggleOff} size="sm" disabled={setEnabled.isPending} onPress={() => { void onToggle(); }} />
          ) : (
            <PrimaryButton testID="whatsapp-kill-switch" label={t.killSwitch.toggleOn} size="sm" disabled={setEnabled.isPending} onPress={() => { void onToggle(); }} />
          )}
        </View>
      </View>

      <Text style={styles.section}>{t.overview.title}</Text>
      <View style={styles.kpiGrid}>
        {kpis.map(([label, value]) => (
          <View key={label} style={styles.kpi}>
            <Text style={styles.kpiValue}>{value}</Text>
            <Text style={styles.kpiLabel}>{label}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.section}>{t.sections.outbound}</Text>
      <AdminFilterTopBarButton
        portalTitle={t.title}
        activeFilterCount={outFilter === 'all' ? 0 : 1}
        filterVisible={sheetOpen}
        onOpenFilters={() => setSheetOpen(true)}
        onCloseFilters={() => setSheetOpen(false)}
        onClearFilters={() => setOutFilter('all')}
        sheetTitle={t.sections.outbound}
        filterButtonTestID="admin-whatsapp-filter-button"
        filterSheetContent={(
          <FilterSection<OutFilter>
            options={(['all', 'queued', 'sent', 'failed'] as const).map((f) => ({
              value: f,
              label: t.filters[f],
            }))}
            value={outFilter}
            onChange={(f) => setOutFilter(f ?? 'all')}
          />
        )}
      />
      {(outbound.data?.rows.length ?? 0) === 0 ? (
        <AdminListEmpty title={t.empty} hint="" />
      ) : (
        outbound.data!.rows.map((row) => (
          <View key={row.outboundId} style={styles.row}>
            <Text style={styles.rowTitle}>{row.templateName ?? row.kind} · {row.status}</Text>
            <Text style={styles.muted}>{t.row.phone}: {row.waIdMasked ?? '—'} · {t.row.attempts(row.attempts)}</Text>
            {row.lastError ? <Text style={styles.error}>{row.lastError}</Text> : null}
            {(row.status === 'failed' || row.status.startsWith('skipped_')) && (
              <Pressable style={styles.linkBtn} onPress={() => { void resend.mutateAsync(row.outboundId); }}>
                <Text style={styles.link}>{t.row.resend}</Text>
              </Pressable>
            )}
          </View>
        ))
      )}

      <Text style={styles.section}>{t.sections.consent}</Text>
      {(consent.data?.rows.length ?? 0) === 0 ? (
        <AdminListEmpty title={t.empty} hint="" />
      ) : (
        consent.data!.rows.map((row, i) => (
          <View key={`${row.userId ?? 'x'}-${i}`} style={styles.row}>
            <Text style={styles.rowTitle}>{row.waIdMasked ?? '—'} · {row.consentStatus}</Text>
            <Text style={styles.muted}>
              {row.optedIn ? t.overview.consentIn : t.overview.consentOut}
              {row.preferredLanguage ? ` · ${t.row.lang} ${row.preferredLanguage}` : ''}
            </Text>
            {row.userId && row.optedIn ? (
              <Pressable
                style={styles.linkBtn}
                onPress={() => {
                  void (async () => {
                    const ok = await platformConfirm(t.confirmBlockTitle, t.confirmBlockBody, {
                      confirmLabel: t.row.block, cancelLabel: t.killSwitch.cancel, destructive: true,
                    });
                    if (ok) await block.mutateAsync(row.userId!);
                  })();
                }}
              >
                <Text style={styles.linkDanger}>{t.row.block}</Text>
              </Pressable>
            ) : null}
          </View>
        ))
      )}

      <Text style={styles.section}>{t.sections.matches}</Text>
      {(matches.data?.length ?? 0) === 0 ? (
        <AdminListEmpty title={t.empty} hint="" />
      ) : (
        matches.data!.map((row) => (
          <View key={row.outboundId} style={styles.row}>
            <Text style={styles.rowTitle}>{row.waIdMasked ?? '—'} · {row.status}</Text>
            <Text style={styles.muted}>{row.createdAt.toISOString()}</Text>
          </View>
        ))
      )}

      <Text style={styles.section}>{t.sections.rateHits}</Text>
      {(rateHits.data?.length ?? 0) === 0 ? (
        <AdminListEmpty title={t.empty} hint="" />
      ) : (
        rateHits.data!.map((row) => (
          <View key={`${row.bucket}-${row.windowStart.toISOString()}`} style={styles.row}>
            <Text style={styles.rowTitle}>{row.bucket}</Text>
            <Text style={styles.muted}>{t.row.hits(row.hits)} · {row.windowStart.toISOString()}</Text>
          </View>
        ))
      )}

      <Text style={styles.section}>{t.sections.conversations}</Text>
      {(conversations.data?.length ?? 0) === 0 ? (
        <AdminListEmpty title={t.empty} hint="" />
      ) : (
        conversations.data!.map((row) => (
          <View key={row.sessionId} style={styles.row}>
            <Text style={styles.rowTitle}>{row.waIdMasked ?? '—'} · {t.row.state}: {row.state}</Text>
            <Text style={styles.muted}>{row.updatedAt.toISOString()}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.base, paddingBottom: spacing['3xl'], gap: spacing.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  forbidden: { color: colors.error, textAlign: 'center' },
  title: { fontSize: typography.h2.fontSize, ...typography.bold, color: colors.textPrimary, marginBottom: spacing.sm },
  section: { marginTop: spacing.base, marginBottom: spacing.xs, fontSize: typography.bodyLarge.fontSize, ...typography.bold, color: colors.textPrimary },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: spacing.sm,
  },
  cardTitle: { ...typography.bold, color: colors.textPrimary },
  muted: { color: colors.textSecondary, fontSize: typography.bodySmall.fontSize },
  error: { color: colors.error, fontSize: typography.bodySmall.fontSize },
  btn: { marginTop: spacing.xs, alignSelf: 'flex-start' },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  kpi: {
    width: '30%', minWidth: 96, backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  kpiValue: { fontSize: typography.h3.fontSize, ...typography.bold, color: colors.textPrimary },
  kpiLabel: { fontSize: typography.caption.fontSize, color: colors.textSecondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs },
  row: {
    backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.xs,
    borderWidth: 1, borderColor: colors.border, gap: spacing.xs,
  },
  rowTitle: { ...typography.semiBold, color: colors.textPrimary },
  linkBtn: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
  link: { color: colors.primary, ...typography.semiBold },
  linkDanger: { color: colors.error, ...typography.semiBold },
}));
