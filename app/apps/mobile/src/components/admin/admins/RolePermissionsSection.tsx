// app/apps/mobile/src/components/admin/admins/RolePermissionsSection.tsx
// FR-ADMIN-030 — what a person may do in the admin portal. Permissions are
// role-derived only (project book D85), so this block lists, per active role,
// the permissions that role carries; changing permissions means changing a role.
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { permissionsOfRole, type AdminRole } from '@kc/domain';
import { iconSize, makeUseStyles, radius, spacing, Text, typography, useTheme } from '@kc/ui';
import { RoleBadge } from './RoleBadge';
import { rowDirectionStart, textAlignStart } from '../../../lib/rtlLayout';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

export interface RolePermissionsSectionProps {
  /** The person's distinct active roles, highest first. */
  readonly roles: readonly AdminRole[];
}

export function RolePermissionsSection({ roles }: RolePermissionsSectionProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const L = useLocaleBundle();
  const copy = L.admin.admins.team.permissions;

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.hint}>{copy.hint}</Text>
      {roles.length === 0 && <Text style={styles.hint}>{copy.empty}</Text>}
      {roles.map((role) => {
        const permissions = permissionsOfRole(role);
        return (
          <View key={role} style={styles.card}>
            <RoleBadge role={role} />
            {permissions.length === 0 ? (
              <Text style={styles.none}>{copy.none}</Text>
            ) : (
              permissions.map((permission) => (
                <View key={permission} style={styles.item}>
                  <Ionicons name="checkmark-circle" size={iconSize.xs} color={colors.primary} />
                  <Text style={styles.itemText}>{L.admin.admins.permissions[permission]}</Text>
                </View>
              ))
            )}
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root:     { gap: spacing.sm, marginTop: spacing.md },
  title:    { ...typography.body, ...typography.extraBold, color: colors.textPrimary, textAlign: textAlignStart() },
  hint:     { ...typography.bodySmall, color: colors.textSecondary, textAlign: textAlignStart() },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm,
    alignItems: 'flex-start',
  },
  none:     { ...typography.bodySmall, color: colors.textSecondary, textAlign: textAlignStart() },
  item:     { flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.sm },
  itemText: { ...typography.bodySmall, color: colors.textPrimary, textAlign: textAlignStart() },
}));
