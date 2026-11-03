// app/apps/mobile/src/components/admin/admins/PersonGrantRow.tsx
// FR-ADMIN-022 / FR-ADMIN-030 — one of a person's grants on their admin
// screen: the role and where it applies, when it was granted (or revoked),
// and the change / revoke actions the viewer has authority for.
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import type { AdminGrant } from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { RoleBadge } from './RoleBadge';
import { rowDirectionStart, textAlignStart } from '../../../lib/rtlLayout';
import { useLocaleBundle, type LocaleBundle } from '../../../i18n/useLocaleBundle';

export interface PersonGrantRowProps {
  readonly grant: AdminGrant;
  /** The grant's org name, or the platform's. */
  readonly orgName: string;
  readonly personName: string;
  /** Viewer has authority over this grant's role in its scope. */
  readonly canManage: boolean;
  readonly busy: boolean;
  readonly onChange: (grant: AdminGrant) => void;
  readonly onRevoke: (grantId: string) => void;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('he-IL', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** Grant date and granter, or the revocation date for a revoked grant. */
function grantMeta(L: LocaleBundle, grant: AdminGrant): string {
  if (grant.revokedAt !== null) return L.admin.admins.row.revokedAt(fmtDate(grant.revokedAt));
  const granted = L.admin.admins.row.grantedAt(fmtDate(grant.grantedAt));
  return grant.grantedByDisplayName
    ? `${granted} · ${L.admin.admins.row.grantedBy(grant.grantedByDisplayName)}`
    : granted;
}

async function confirmRevoke(L: LocaleBundle, name: string): Promise<boolean> {
  const msg = L.admin.admins.row.revokeConfirm(name);
  if (Platform.OS === 'web') {
    return typeof window !== 'undefined' && window.confirm(msg);
  }
  return new Promise<boolean>((resolve) => {
    Alert.alert(L.admin.admins.row.revokeTitle, msg, [
      { text: L.admin.admins.row.revokeCancel, style: 'cancel', onPress: () => resolve(false) },
      { text: L.admin.admins.row.revokeConfirmAction, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

export function PersonGrantRow(props: PersonGrantRowProps) {
  const { grant, orgName, personName, canManage, busy, onChange, onRevoke } = props;
  const styles = useStyles();
  const L = useLocaleBundle();
  const active = grant.revokedAt === null;

  const onRevokePress = async () => {
    if (await confirmRevoke(L, personName)) onRevoke(grant.grantId);
  };

  return (
    <View style={[styles.root, !active && styles.rootRevoked]}>
      <View style={styles.main}>
        <View style={styles.headline}>
          <RoleBadge role={grant.role} muted={!active} />
          <Text style={styles.org} numberOfLines={1}>{orgName}</Text>
        </View>
        <Text style={styles.meta}>{grantMeta(L, grant)}</Text>
      </View>
      {canManage && active && (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => onChange(grant)}
            style={[styles.changeBtn, busy && styles.disabled]}
          >
            <Text style={styles.changeText}>{L.admin.admins.team.changeRole}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => { void onRevokePress(); }}
            style={[styles.revokeBtn, busy && styles.disabled]}
          >
            <Text style={styles.revokeText}>{L.admin.admins.row.revokeShort}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root: {
    flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.md, paddingHorizontal: spacing.base,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  rootRevoked: { opacity: 0.55 },
  main:        { flex: 1, gap: spacing.xs },
  headline:    { flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  org:         { ...typography.bodySmall, ...typography.semiBold, color: colors.textPrimary, flexShrink: 1 },
  meta:        { ...typography.caption, color: colors.textSecondary, textAlign: textAlignStart() },
  actions:     { flexDirection: rowDirectionStart, gap: spacing.sm },
  changeBtn: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm,
    backgroundColor: colors.primarySurface,
  },
  changeText:  { ...typography.bodySmall, ...typography.semiBold, color: colors.primary },
  // An outlined danger button: error text on the surface keeps AA contrast
  // (an error-tinted fill would not, see TD-130).
  revokeBtn: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.error,
  },
  revokeText:  { ...typography.bodySmall, ...typography.semiBold, color: colors.error },
  disabled:    { opacity: 0.5 },
}));
