// app/apps/mobile/src/components/admin/admins/ChangeRoleModal.tsx
// FR-ADMIN-030 — change one grant's role in place. The new role keeps the
// grant's org, direct manager and reports (atomic `admin_change_role`), so
// the person keeps their place in the hierarchy.
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import {
  changeTargetsFor, isAdminRoleError, type AdminGrant, type GrantableAdminRole, type ViewerAuthority,
} from '@kc/domain';
import { makeUseStyles, spacing, Text, typography } from '@kc/ui';
import { useChangeAdminRole } from '../../../hooks/useAdminRoleMutations';
import { ChoiceChips } from './ChoiceChips';
import { roleScopeErrorText } from './roleErrors';
import { textAlignStart } from '../../../lib/rtlLayout';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';
import { GhostButton, PrimaryButton } from '../../ui/Buttons';
import { Modal } from '../../ui/Modal';

export interface ChangeRoleModalProps {
  /** The grant being changed; null hides the modal. */
  readonly grant: AdminGrant | null;
  /** Display name of the grant's org (or the platform). */
  readonly orgName: string;
  readonly authority: ViewerAuthority;
  readonly onClose: () => void;
}

export function ChangeRoleModal({ grant, orgName, authority, onClose }: ChangeRoleModalProps) {
  const styles = useStyles();
  const L = useLocaleBundle();
  const copy = L.admin.admins.team.changeModal;
  const change = useChangeAdminRole();
  const [role, setRole] = useState<GrantableAdminRole | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  // Fresh form for every grant the modal opens on.
  useEffect(() => {
    setRole(null);
    setErrorCode(null);
  }, [grant?.grantId]);

  const targets = useMemo(() => (grant ? changeTargetsFor(authority, grant) : []), [authority, grant]);
  const canSubmit = grant !== null && role !== null && !change.isPending;

  async function submit() {
    if (!grant || !role) return;
    setErrorCode(null);
    try {
      await change.mutateAsync({ grantId: grant.grantId, newRole: role });
      onClose();
    } catch (e) {
      setErrorCode(isAdminRoleError(e) ? e.code : 'unknown');
    }
  }

  return (
    <Modal
      visible={grant !== null}
      title={copy.title}
      onDismiss={onClose}
      footer={
        <>
          <PrimaryButton
            label={copy.submit}
            size="md"
            fullWidth
            disabled={!canSubmit}
            loading={change.isPending}
            onPress={() => { void submit(); }}
          />
          <GhostButton label={copy.cancel} size="md" fullWidth onPress={onClose} />
        </>
      }
    >
      <View style={styles.body}>
        {grant && <Text style={styles.current}>{copy.current(L.admin.roles[grant.role], orgName)}</Text>}
        <Text style={styles.hint}>{copy.hint}</Text>

        <Text style={styles.label}>{copy.roleLabel}</Text>
        {targets.length === 0 ? (
          <Text style={styles.hint}>{copy.noTargets}</Text>
        ) : (
          <ChoiceChips
            options={targets.map((r) => ({ key: r, label: L.admin.roles[r] }))}
            selected={role ?? undefined}
            onSelect={setRole}
          />
        )}

        {errorCode !== null && <Text style={styles.errorText}>{roleScopeErrorText(L, errorCode)}</Text>}
      </View>
    </Modal>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  body:      { gap: spacing.sm },
  current:   { ...typography.body, ...typography.semiBold, color: colors.textPrimary, textAlign: textAlignStart() },
  hint:      { ...typography.bodySmall, color: colors.textSecondary, textAlign: textAlignStart() },
  label: {
    ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm, textAlign: textAlignStart(),
  },
  errorText: { ...typography.bodySmall, color: colors.error, textAlign: textAlignStart() },
}));
