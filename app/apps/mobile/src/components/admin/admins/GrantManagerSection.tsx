// app/apps/mobile/src/components/admin/admins/GrantManagerSection.tsx
// FR-ADMIN-025 / FR-ADMIN-030 — direct manager + subordinates for a single
// grant, with assign / change / clear offered only within the viewer's
// authority (`admins.set_manager` + GrantAuthority, FR-ADMIN-027). The
// read-only display lives in ManagerSummary; this owns the mutation + picker.
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import {
  canDetachManager, canManageGrant, isOrgHierarchyError, managerCandidatesFor, type OrgTreeMember,
} from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { PrimaryButton, SecondaryButton } from '../../ui/Buttons';
import { RoleBadge } from './RoleBadge';
import { ManagerSummary } from './ManagerSummary';
import { ManagerPickerModal } from './ManagerPickerModal';
import { useSetManager } from '../../../hooks/useSetManager';
import { useGrantAuthority } from '../../../hooks/useGrantAuthority';
import { rowDirectionStart } from '../../../lib/rtlLayout';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

export interface GrantManagerSectionProps {
  readonly member: OrgTreeMember;
  readonly members: readonly OrgTreeMember[];
  readonly canManage: boolean;
}

export function GrantManagerSection({ member, members, canManage }: GrantManagerSectionProps) {
  const styles = useStyles();
  const L = useLocaleBundle();
  const setManager = useSetManager();
  const { authority } = useGrantAuthority();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const manager = useMemo(
    () => members.find((m) => m.grantId === member.managerGrantId) ?? null,
    [members, member.managerGrantId],
  );
  const subordinates = useMemo(
    () => members.filter((m) => m.managerGrantId === member.grantId),
    [members, member.grantId],
  );
  const candidates = useMemo(
    () => managerCandidatesFor(authority, member, members),
    [authority, member, members],
  );
  // The permission opens the affordance; the position decides this grant.
  const canAct = canManage && canManageGrant(authority, member);
  const canDetach = canDetachManager(authority);

  async function pick(managerGrantId: string | null): Promise<void> {
    setErr(null);
    try {
      await setManager.mutateAsync({ grantId: member.grantId, managerGrantId });
      setPickerOpen(false);
    } catch (e) {
      setErr(isOrgHierarchyError(e) ? e.code : 'unknown');
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <RoleBadge role={member.role} />
        {member.orgName !== null && <Text style={styles.org}>{member.orgName}</Text>}
      </View>

      <ManagerSummary
        managerName={manager?.displayName ?? null}
        subordinates={subordinates}
        errCode={err}
      />

      {canAct && (
        <View style={styles.actions}>
          {/* Compact admin size (spec 17 §4.3). */}
          <PrimaryButton
            testID="grant-manager-assign"
            label={manager ? L.admin.admins.detail.changeManager : L.admin.admins.detail.assignManager}
            size="sm"
            disabled={setManager.isPending}
            onPress={() => { setErr(null); setPickerOpen(true); }}
          />
          {manager && canDetach && (
            <SecondaryButton
              testID="grant-manager-clear"
              label={L.admin.admins.detail.clearManager}
              size="sm"
              disabled={setManager.isPending}
              onPress={() => { void pick(null); }}
            />
          )}
        </View>
      )}

      <ManagerPickerModal
        visible={pickerOpen}
        candidates={candidates}
        busy={setManager.isPending}
        allowDetach={canDetach}
        onPick={(id) => { void pick(id); }}
        onClose={() => setPickerOpen(false)}
      />
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs,
    marginTop: spacing.sm,
  },
  head: { flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  org:  { ...typography.caption, color: colors.textSecondary },
  actions: { flexDirection: rowDirectionStart, gap: spacing.sm, marginTop: spacing.md },
}));
