// app/apps/mobile/src/components/admin/admins/PersonRolesSection.tsx
// FR-ADMIN-030 — the roles block of the admin person screen: every grant with
// its org, plus add / change / revoke for the grants the viewer has authority
// over (GrantAuthority mirrors the server's `can_grant_role` and
// `can_manage_grant`, FR-ADMIN-027).
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { canRevokeGrant, type AdminGrant } from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { PrimaryButton } from '../../ui/Buttons';
import { useRevokeAdminRole } from '../../../hooks/useAdminRoleMutations';
import { notAvailableMessage } from '../../../lib/backendAvailability';
import { BACKEND_UNAVAILABLE_CODE, roleErrorCode } from './roleErrors';
import { useGrantAuthority } from '../../../hooks/useGrantAuthority';
import { useHierarchyPyramid } from '../../../hooks/useHierarchyPyramid';
import { PersonGrantRow } from './PersonGrantRow';
import { GrantRoleModal } from './GrantRoleModal';
import { ChangeRoleModal } from './ChangeRoleModal';
import { rowDirectionStart, textAlignStart } from '../../../lib/rtlLayout';
import { useLocaleBundle, type LocaleBundle } from '../../../i18n/useLocaleBundle';

export interface PersonRolesSectionProps {
  readonly userId: string;
  readonly personName: string;
  /** Every grant of the person (active and revoked) the viewer may see. */
  readonly grants: readonly AdminGrant[];
}

type RevokeErrors = LocaleBundle['admin']['admins']['revokeErrors'];

function revokeErrorText(L: LocaleBundle, code: string): string {
  if (code === BACKEND_UNAVAILABLE_CODE) return notAvailableMessage();
  const errors: RevokeErrors = L.admin.admins.revokeErrors;
  return code in errors ? errors[code as keyof RevokeErrors] : errors.unknown;
}

export function PersonRolesSection({ userId, personName, grants }: PersonRolesSectionProps) {
  const styles = useStyles();
  const L = useLocaleBundle();
  const team = L.admin.admins.team;
  const { authority, scopes } = useGrantAuthority();
  const { pyramid } = useHierarchyPyramid(null);
  const revoke = useRevokeAdminRole();
  const [adding, setAdding] = useState(false);
  const [changing, setChanging] = useState<AdminGrant | null>(null);
  const [revokeErr, setRevokeErr] = useState<string | null>(null);

  // Org names by scope; platform grants (scope null) take the platform org's name.
  const orgNameOf = useMemo(() => {
    const names = new Map<string | null, string>();
    for (const org of pyramid?.orgs ?? []) names.set(org.isPlatform ? null : org.orgId, org.name);
    return (scopeOrgId: string | null) => names.get(scopeOrgId) ?? team.platformScope;
  }, [pyramid?.orgs, team.platformScope]);

  async function onRevoke(grantId: string) {
    setRevokeErr(null);
    try { await revoke.mutateAsync(grantId); }
    catch (e) { setRevokeErr(roleErrorCode(e)); }
  }

  const hasActive = grants.some((g) => g.revokedAt === null);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>{L.admin.admins.detail.rolesSection}</Text>
        {scopes.length > 0 && (
          <PrimaryButton testID="person-roles-add" label={team.addRole} size="sm" icon="add" onPress={() => setAdding(true)} />
        )}
      </View>

      {revokeErr !== null && <Text style={styles.errorBanner}>{revokeErrorText(L, revokeErr)}</Text>}
      {!hasActive && <Text style={styles.hint}>{team.rolesNone}</Text>}

      {grants.length > 0 && (
        <View style={styles.card}>
          {grants.map((g) => (
            <PersonGrantRow
              key={g.grantId}
              grant={g}
              orgName={orgNameOf(g.scopeOrgId)}
              personName={personName}
              canManage={canRevokeGrant(authority, g)}
              busy={revoke.isPending}
              onChange={setChanging}
              onRevoke={(id) => { void onRevoke(id); }}
            />
          ))}
        </View>
      )}

      <GrantRoleModal
        visible={adding}
        onClose={() => setAdding(false)}
        presetUser={{ userId, displayName: personName }}
      />
      <ChangeRoleModal
        grant={changing}
        orgName={changing ? orgNameOf(changing.scopeOrgId) : ''}
        authority={authority}
        onClose={() => setChanging(null)}
      />
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root:   { gap: spacing.sm },
  header: { flexDirection: rowDirectionStart, alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md },
  title:  { ...typography.body, ...typography.extraBold, color: colors.textPrimary, textAlign: textAlignStart() },
  errorBanner: {
    ...typography.caption, color: colors.error, backgroundColor: colors.errorLight,
    padding: spacing.md, borderRadius: radius.sm, textAlign: textAlignStart(),
  },
  hint:   { ...typography.bodySmall, color: colors.textSecondary, textAlign: textAlignStart() },
  card:   { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden' },
}));
