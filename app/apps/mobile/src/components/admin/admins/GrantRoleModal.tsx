// app/apps/mobile/src/components/admin/admins/GrantRoleModal.tsx
// FR-ADMIN-016 / FR-ADMIN-030 — grant a role to an active user.
//
// The viewer picks where (the platform or one of their orgs) and which role;
// both lists come from GrantAuthority, so only grants the server will accept
// are offered. Opened from the team screen (user lookup) or from a person's
// screen (user fixed via `presetUser`).
import { useEffect, useMemo, useState } from 'react';
import { ScrollView } from 'react-native';
import { grantableRolesIn, isAdminRoleError, type GrantableAdminRole } from '@kc/domain';
import { makeUseStyles, spacing, Text, typography } from '@kc/ui';
import { useGrantAdminRole } from '../../../hooks/useAdminRoleMutations';
import { useGrantAuthority } from '../../../hooks/useGrantAuthority';
import { ChoiceChips } from './ChoiceChips';
import { UserLookupField, type PickedUser } from './UserLookupField';
import { roleScopeErrorText } from './roleErrors';
import { textAlignStart } from '../../../lib/rtlLayout';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';
import { GhostButton, PrimaryButton } from '../../ui/Buttons';
import { Modal } from '../../ui/Modal';

export interface GrantRoleModalProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  /** Fixes the target user (person screen); omitted on the team screen. */
  readonly presetUser?: PickedUser;
}

export function GrantRoleModal({ visible, onClose, presetUser }: GrantRoleModalProps) {
  const styles = useStyles();
  const L = useLocaleBundle();
  const copy = L.admin.admins.grantModal;
  const team = L.admin.admins.team;
  const { authority, scopes } = useGrantAuthority();
  const grant = useGrantAdminRole();
  const [user, setUser] = useState<PickedUser | null>(presetUser ?? null);
  // `undefined` = no scope picked yet; `null` = the platform.
  const [scope, setScope] = useState<string | null | undefined>(undefined);
  const [role, setRole] = useState<GrantableAdminRole | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  // Reset on every open only, so a background refetch never wipes the form.
  useEffect(() => {
    if (!visible) return;
    setUser(presetUser ?? null);
    setScope(undefined);
    setRole(null);
    setErrorCode(null);
  }, [visible, presetUser]);

  // A viewer who can grant in exactly one place gets it preselected.
  const onlyScope = scopes.length === 1 ? scopes[0]?.scopeOrgId : undefined;
  const activeScope = scope !== undefined ? scope : onlyScope;
  const roles = useMemo(
    () => (activeScope === undefined ? [] : grantableRolesIn(authority.grants, activeScope)),
    [authority.grants, activeScope],
  );
  const scopeOptions = scopes.map((s) => ({
    key: s.scopeOrgId,
    label: s.scopeOrgId === null ? `${s.name} · ${team.platformScope}` : s.name,
  }));
  const canSubmit = user !== null && activeScope !== undefined && role !== null && !grant.isPending;

  async function submit() {
    if (!user || activeScope === undefined || !role) return;
    setErrorCode(null);
    try {
      await grant.mutateAsync({ targetUserId: user.userId, role, scopeOrgId: activeScope });
      onClose();
    } catch (e) {
      setErrorCode(isAdminRoleError(e) ? e.code : 'unknown');
    }
  }

  return (
    <Modal
      visible={visible}
      title={copy.title}
      onDismiss={onClose}
      footer={
        <>
          <PrimaryButton
            label={copy.submit}
            size="md"
            fullWidth
            disabled={!canSubmit}
            loading={grant.isPending}
            onPress={() => { void submit(); }}
          />
          <GhostButton label={copy.cancel} size="md" fullWidth onPress={onClose} />
        </>
      }
    >
      {/* The user lookup and both choice lists can outgrow a phone screen: scroll them, keep the actions pinned. */}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
        <Text style={styles.label}>{copy.searchLabel}</Text>
        <UserLookupField selected={user} onSelect={setUser} changeable={presetUser === undefined} />

        <Text style={styles.label}>{team.scope.label}</Text>
        {scopes.length === 0 ? (
          <Text style={styles.hint}>{team.scope.none}</Text>
        ) : (
          <ChoiceChips
            options={scopeOptions}
            selected={activeScope}
            onSelect={(key) => { setScope(key); setRole(null); }}
          />
        )}

        {activeScope !== undefined && (
          <>
            <Text style={styles.label}>{copy.roleLabel}</Text>
            <ChoiceChips
              options={roles.map((r) => ({ key: r, label: L.admin.roles[r] }))}
              selected={role ?? undefined}
              onSelect={setRole}
            />
          </>
        )}

        {errorCode !== null && <Text style={styles.errorText}>{roleScopeErrorText(L, errorCode)}</Text>}
      </ScrollView>
    </Modal>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  // Shrink inside the dialog's height cap so the footer stays on screen.
  scroll:    { flexGrow: 0, flexShrink: 1 },
  body:      { gap: spacing.sm },
  label: {
    ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm, textAlign: textAlignStart(),
  },
  hint:      { ...typography.bodySmall, color: colors.textSecondary, textAlign: textAlignStart() },
  errorText: { ...typography.bodySmall, color: colors.error, marginTop: spacing.sm, textAlign: textAlignStart() },
}));
