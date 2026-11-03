// app/apps/mobile/src/components/admin/admins/AdminManagerSections.tsx
// FR-ADMIN-025 — direct-manager + subordinates blocks on the admin-detail
// screen, one per org membership. Owns the org-tree read so the screen stays
// thin.
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { iconSize, makeUseStyles, radius, spacing, Text, typography, useTheme } from '@kc/ui';
import { useOrgTree } from '../../../hooks/useOrgTree';
import { GrantManagerSection } from './GrantManagerSection';
import { rowDirectionStart, textAlignStart } from '../../../lib/rtlLayout';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

export interface AdminManagerSectionsProps {
  readonly userId: string;
  readonly canManage: boolean;
}

export function AdminManagerSections({ userId, canManage }: AdminManagerSectionsProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const L = useLocaleBundle();
  const tree = useOrgTree(null);
  const memberships = tree.members.filter((m) => m.userId === userId);

  return (
    <View>
      <Text style={styles.sectionTitle}>{L.admin.admins.detail.managerSection}</Text>
      {memberships.length === 0 ? (
        <View style={styles.placeholder}>
          <Ionicons name="git-network-outline" size={iconSize.lg} color={colors.textSecondary} />
          <Text style={styles.hint}>{L.admin.admins.detail.managerNone}</Text>
        </View>
      ) : (
        memberships.map((m) => (
          <GrantManagerSection key={m.grantId} member={m} members={tree.members} canManage={canManage} />
        ))
      )}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  sectionTitle: { fontSize: typography.body.fontSize, ...typography.extraBold, color: colors.textPrimary, marginTop: spacing.md, textAlign: textAlignStart() },
  placeholder: {
    flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
  },
  hint: { flex: 1, fontSize: typography.bodySmall.fontSize, color: colors.textSecondary, textAlign: textAlignStart() },
}));
