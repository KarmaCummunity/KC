// app/apps/mobile/app/(admin)/org-approvals/index.tsx
// V2-ADMIN-ORG-7 — V2 §13.12 Admin Org Approvals foundation.
// Lists pending NGO applications and lets a privileged admin approve or
// reject each one. The "approval = create organization" side-effect is
// out of scope here — it lands in a separate slice when the org world
// schema is built.
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { adminChipScroll } from '../../../src/components/admin/adminChipScroll';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  hasPermission, isOrgApplicationError,
  type AdminPermission, type AdminRole,
  type OrgApplication, type OrgApplicationStatus,
} from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography, platformSelect } from '@kc/ui';
import { Chip } from '../../../src/components/ui/Chip';
import { DangerButton, PrimaryButton } from '../../../src/components/ui/Buttons';
import { TextField } from '../../../src/components/ui/TextField';
import { useAdminRoles } from '../../../src/hooks/useAdminRoles';
import { container } from '../../../src/lib/container';
import { useLocaleBundle, type LocaleBundle } from '../../../src/i18n/useLocaleBundle';
import { useAdminScreenTitle } from '../../../src/components/admin/useAdminScreenTitle';
import { KcFlashList } from '../../../src/components/lists/KcFlashList';

type StatusFilter = OrgApplicationStatus | 'all';

const STATUS_TABS: readonly StatusFilter[] = ['pending', 'approved', 'rejected', 'all'];

const orgApplicationKeyExtractor = (a: OrgApplication) => a.applicationId;

async function confirmAction(message: string, L: LocaleBundle): Promise<boolean> {
  if (platformSelect({ web: true, default: false })) {
    return typeof window !== 'undefined' && window.confirm(message);
  }
  return new Promise<boolean>((resolve) => {
    Alert.alert(L.admin.tasks.detail.confirmTitle, message, [
      { text: L.admin.tasks.detail.cancel, style: 'cancel', onPress: () => resolve(false) },
      { text: L.admin.tasks.detail.confirmOk, onPress: () => resolve(true) },
    ]);
  });
}

function fmt(dt: Date): string {
  return dt.toLocaleString('he-IL', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function OrgApprovalsScreen() {
  const styles = useStyles();
  const L = useLocaleBundle();
  const t = L.admin.orgApprovals;
  const { roles, isLoading: rolesLoading } = useAdminRoles();
  const can = (perm: AdminPermission) => hasPermission(roles as readonly AdminRole[], perm);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<StatusFilter>('pending');

  useAdminScreenTitle(t.title);

  const filters = useMemo(() => ({
    status: tab === 'all' ? undefined : tab,
    limit: 100,
  }), [tab]);

  const query = useQuery({
    queryKey: ['admin.org-approvals', filters],
    queryFn:  () => container.listOrgApplications.execute(filters),
    enabled:  can('org.review_applications'),
    staleTime: 30_000,
  });

  const decide = useMutation({
    mutationFn: (vars: { applicationId: string; approve: boolean; note: string }) =>
      container.decideOrgApplication.execute({
        applicationId: vars.applicationId,
        approve: vars.approve,
        note: vars.note.trim() || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin.org-approvals'] });
    },
  });

  const handleDecide = useCallback(
    async (applicationId: string, approve: boolean, note: string) => {
      const ok = await confirmAction(approve ? t.actions.confirmApprove : t.actions.confirmReject, L);
      if (!ok) return;
      try {
        await decide.mutateAsync({ applicationId, approve, note });
      } catch (err) {
        const code = isOrgApplicationError(err) ? err.code : 'unknown';
        const msg = t.errors[code as keyof typeof t.errors] ?? t.errors.unknown;
        if (platformSelect({ web: true, default: false })) {
          if (typeof window !== 'undefined') window.alert(msg);
        } else {
          Alert.alert(msg);
        }
      }
    },
    [L, decide, t],
  );

  const renderItem = useCallback(
    ({ item }: { item: OrgApplication }) => (
      <ApplicationCard
        application={item}
        busy={decide.isPending}
        onDecide={handleDecide}
      />
    ),
    [decide.isPending, handleDecide],
  );

  if (rolesLoading) {
    return <View style={styles.center}><Text>{t.loading}</Text></View>;
  }
  if (!can('org.review_applications')) {
    return <View style={styles.center}><Text style={styles.deniedTitle}>{t.forbiddenTitle}</Text></View>;
  }

  return (
    <View style={styles.root}>
      <ScrollView horizontal style={adminChipScroll.scroll} showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chips, adminChipScroll.content]}>
        {STATUS_TABS.map((s) => (
          <Chip
            key={s}
            label={t.filters[s]}
            selected={tab === s}
            onPress={() => setTab(s)}
            size="sm"
          />
        ))}
      </ScrollView>
      <Text style={styles.totalLabel}>{t.totalCount(query.data?.totalCount ?? 0)}</Text>
      <KcFlashList
        data={query.data?.rows ?? []}
        keyExtractor={orgApplicationKeyExtractor}
        estimatedItemSize={180}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl refreshing={query.isRefetching} onRefresh={() => { void query.refetch(); }} />
        }
        ListEmptyComponent={
          !query.isLoading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{t.emptyTitle}</Text>
              <Text style={styles.emptyHint}>{t.emptyHint}</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

interface ApplicationCardProps {
  readonly application: OrgApplication;
  readonly busy: boolean;
  readonly onDecide: (applicationId: string, approve: boolean, note: string) => Promise<void>;
}

function ApplicationCardInner({ application, busy, onDecide }: ApplicationCardProps) {
  const styles = useStyles();
  const L = useLocaleBundle();
  const t = L.admin.orgApprovals;
  const [note, setNote] = useState('');

  const showActions = application.status === 'pending';

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.orgName}>{application.orgName}</Text>
        <Chip
          variant="tag"
          tone={application.status === 'approved' ? 'success' : application.status === 'rejected' ? 'error' : 'warning'}
          label={t.status[application.status]}
          size="sm"
        />
      </View>
      <Text style={styles.meta}>
        {t.row.submittedBy(application.applicantName ?? application.applicantUserId.slice(0, 8))}
      </Text>
      <Text style={styles.meta}>{t.row.submittedAt(fmt(application.createdAt))}</Text>
      {application.orgDescription && (
        <Text style={styles.description} numberOfLines={6}>{application.orgDescription}</Text>
      )}
      <View style={styles.contactCol}>
        {application.contactEmail && <Text style={styles.contact}>✉ {application.contactEmail}</Text>}
        {application.contactPhone && <Text style={styles.contact}>📞 {application.contactPhone}</Text>}
        {application.websiteUrl && <Text style={styles.contact}>🔗 {application.websiteUrl}</Text>}
      </View>

      {application.status !== 'pending' && application.reviewerName && (
        <Text style={styles.meta}>{t.row.decidedBy(application.reviewerName)}</Text>
      )}
      {application.reviewedAt && (
        <Text style={styles.meta}>{t.row.decidedAt(fmt(application.reviewedAt))}</Text>
      )}
      {application.reviewNote && (
        <View style={styles.notePreview}>
          <Text style={styles.noteLabel}>{t.row.noteLabel}</Text>
          <Text style={styles.noteText}>{application.reviewNote}</Text>
        </View>
      )}

      {showActions && (
        <>
          <TextField
            label={t.row.noteLabel}
            value={note}
            onChangeText={setNote}
            placeholder={t.row.noteLabel}
            multiline
          />
          <View style={styles.actions}>
            <DangerButton
              label={busy ? t.actions.busy : t.actions.reject}
              size="sm"
              disabled={busy}
              onPress={() => { void onDecide(application.applicationId, false, note); }}
            />
            <PrimaryButton
              label={busy ? t.actions.busy : t.actions.approve}
              size="sm"
              disabled={busy}
              onPress={() => { void onDecide(application.applicationId, true, note); }}
            />
          </View>
        </>
      )}
    </View>
  );
}

const ApplicationCard = React.memo(ApplicationCardInner);

const useStyles = makeUseStyles(({ colors }) => ({
  root:        { flex: 1, backgroundColor: colors.background },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  deniedTitle: { ...typography.h3, ...typography.bold, color: colors.textPrimary },
  title:       { ...typography.h2, ...typography.bold, color: colors.textPrimary, paddingHorizontal: spacing.base, paddingTop: spacing.base, paddingBottom: spacing.xs },
  chips:       { paddingHorizontal: spacing.base, gap: spacing.sm, paddingBottom: spacing.sm },
  totalLabel:  { paddingHorizontal: spacing.base, paddingBottom: spacing.sm, ...typography.caption, color: colors.textSecondary },
  empty:       { padding: spacing['2xl'], alignItems: 'center', gap: spacing.sm },
  emptyTitle:  { ...typography.bodyLarge, ...typography.semiBold, color: colors.textPrimary },
  emptyHint:   { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'center' },

  card: {
    margin: spacing.md, padding: spacing.md, gap: spacing.xs,
    borderRadius: radius.md, backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  orgName:        { ...typography.bodyLarge, ...typography.bold, flex: 1, paddingEnd: spacing.sm, color: colors.textPrimary },
  meta:           { ...typography.caption, color: colors.textSecondary },
  description:    { ...typography.bodySmall, color: colors.textPrimary, marginTop: spacing.xs },
  contactCol:     { gap: spacing.xs, marginTop: spacing.xs },
  contact:        { ...typography.bodySmall, color: colors.textSecondary },
  notePreview:    { marginTop: spacing.xs, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.skeleton, gap: spacing.xs },
  noteLabel:      { ...typography.caption, ...typography.bold, color: colors.textSecondary },
  noteText:       { ...typography.bodySmall, color: colors.textPrimary },
  actions:        { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
}));