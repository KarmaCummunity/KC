// app/apps/mobile/src/components/admin/reports/CaseActions.tsx
// FR-ADMIN-013 — permission-gated action buttons on a report case detail.
// Buttons are wholly driven by PERMISSION_MATRIX in @kc/domain. Adding a new
// action in a future iteration is: matrix entry + action id + i18n label.
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  type AdminPermission,
  type AdminRole,
  type ReportCaseDetail,
  hasPermission,
} from '@kc/domain';
import { makeUseStyles, spacing, platformSelect } from '@kc/ui';
import { DangerButton, SecondaryButton } from '../../ui/Buttons';
import { container } from '../../../lib/container';
import { notAvailableMessage, runAction } from '../../../lib/backendAvailability';
import { showAdminToast } from '../../chat/system/adminActions';
import { useAdminRoles } from '../../../hooks/useAdminRoles';
import { useAuthStore } from '../../../store/authStore';
import { useLocaleBundle, type LocaleBundle } from '../../../i18n/useLocaleBundle';

export interface CaseActionsProps {
  readonly detail: ReportCaseDetail;
  readonly onActed: () => void;
}

type ActionId =
  | 'confirm' | 'dismiss' | 'restore'
  | 'permanentBan' | 'manualRemove' | 'openSupport';

async function confirmDialog(L: LocaleBundle, question: string): Promise<boolean> {
  if (platformSelect({ web: true, default: false })) {
    return typeof window !== 'undefined' && window.confirm(question);
  }
  return new Promise<boolean>((resolve) => {
    Alert.alert(L.admin.caseDetail.confirmDialog.title, question, [
      { text: L.admin.caseDetail.confirmDialog.cancel, style: 'cancel', onPress: () => resolve(false) },
      { text: L.admin.caseDetail.confirmDialog.ok, onPress: () => resolve(true) },
    ]);
  });
}

export function CaseActions({ detail, onActed }: CaseActionsProps) {
  const { roles } = useAdminRoles();
  const adminId = useAuthStore((s) => s.session?.userId ?? null);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const styles = useStyles();
  const L = useLocaleBundle();

  /** Performs one action; resolves false when there was nothing to do for this case. */
  async function perform(action: ActionId): Promise<boolean> {
    const openReports = detail.reporters.filter((r) => r.status === 'open');
    switch (action) {
      case 'confirm':
        for (const r of openReports) await container.confirmReport.execute({ reportId: r.reportId });
        return openReports.length > 0;
      case 'dismiss':
        for (const r of openReports) await container.dismissReport.execute({ reportId: r.reportId });
        return openReports.length > 0;
      case 'restore':
        // A comment has no staff restore (the baseline only deletes it).
        if (detail.targetType === 'comment') return false;
        await container.restoreTarget.execute({ targetType: detail.targetType, targetId: detail.targetId });
        return true;
      case 'permanentBan':
        if (detail.targetType !== 'user' || !adminId) return false;
        await container.banUser.execute({
          adminId,
          targetUserId: detail.targetId,
          reason: 'policy_violation',
          note: '',
        });
        return true;
      case 'manualRemove':
        if (detail.targetType !== 'post') return false;
        await container.adminRemovePost.execute({ postId: detail.targetId });
        return true;
      case 'openSupport':
        // FR-ADMIN-013 — A4 will wire this to the actual support-thread flow
        // (find-or-create 1:1 with the latest reporter or target user). A1 ships
        // it as a no-op stub so the action shape stays stable.
        return true;
    }
  }

  async function run(action: ActionId): Promise<void> {
    const ok = await confirmDialog(L, L.admin.caseDetail.confirmDialog.message);
    if (!ok) return;
    setBusy(true);
    try {
      const outcome = await runAction(() => perform(action));
      if (outcome.status === 'unavailable') {
        // Degrade rule: the backend has no such action yet.
        showAdminToast(notAvailableMessage());
        return;
      }
      if (!outcome.value) return;
      await queryClient.invalidateQueries({ queryKey: ['admin.reports.inbox'] });
      onActed();
    } finally {
      setBusy(false);
    }
  }

  function show(perm: AdminPermission): boolean {
    return hasPermission(roles as readonly AdminRole[], perm);
  }

  return (
    <View style={styles.row}>
      {show('reports.confirm_or_dismiss') && (
        <SecondaryButton
          label={L.admin.caseDetail.actionLabels.confirm}
          size="sm"
          disabled={busy}
          onPress={() => { void run('confirm'); }}
        />
      )}
      {show('reports.confirm_or_dismiss') && (
        <SecondaryButton
          label={L.admin.caseDetail.actionLabels.dismiss}
          size="sm"
          disabled={busy}
          onPress={() => { void run('dismiss'); }}
        />
      )}
      {show('reports.restore_target') && detail.targetType !== 'comment' && (
        <SecondaryButton
          label={L.admin.caseDetail.actionLabels.restore}
          size="sm"
          disabled={busy}
          onPress={() => { void run('restore'); }}
        />
      )}
      {show('reports.manual_remove_post') && detail.targetType === 'post' && (
        <SecondaryButton
          label={L.admin.caseDetail.actionLabels.manualRemove}
          size="sm"
          disabled={busy}
          onPress={() => { void run('manualRemove'); }}
        />
      )}
      {show('reports.permanent_ban') && detail.targetType === 'user' && (
        <DangerButton
          label={L.admin.caseDetail.actionLabels.permanentBan}
          size="sm"
          disabled={busy}
          onPress={() => { void run('permanentBan'); }}
        />
      )}
    </View>
  );
}

const useStyles = makeUseStyles(() => ({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.md },
}));
