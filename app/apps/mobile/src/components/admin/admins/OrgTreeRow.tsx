// app/apps/mobile/src/components/admin/admins/OrgTreeRow.tsx
// FR-ADMIN-025 — one person card in the org hierarchy tree: avatar, name, every
// role they hold in the org, and how many people sit below them.
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { OrgPersonNode } from '@kc/domain';
import { iconSize, makeUseStyles, radius, spacing, Text, typography, useTheme } from '@kc/ui';
import { AvatarInitials } from '../../AvatarInitials';
import { RoleBadge } from './RoleBadge';
import { rowDirectionStart, textAlignStart } from '../../../lib/rtlLayout';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

export interface OrgTreeRowProps {
  readonly node: OrgPersonNode;
  readonly collapsed: boolean;
  readonly onToggle: (key: string) => void;
  readonly onSelect?: (userId: string) => void;
}

export function OrgTreeRow({ node, collapsed, onToggle, onSelect }: OrgTreeRowProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const L = useLocaleBundle();
  const { person, level, children, reportCount } = node;
  const hasChildren = children.length > 0;
  const name = person.displayName ?? L.admin.admins.row.unnamed;

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={collapsed ? L.admin.orgTree.expand : L.admin.orgTree.collapse}
        disabled={!hasChildren}
        hitSlop={6}
        onPress={() => onToggle(person.key)}
        style={styles.chevron}
      >
        {hasChildren && (
          <Ionicons
            name={collapsed ? 'chevron-forward' : 'chevron-down'}
            size={iconSize.sm}
            color={colors.textSecondary}
          />
        )}
      </Pressable>

      <Pressable
        accessibilityRole="button"
        onPress={() => onSelect?.(person.userId)}
        style={[styles.card, level === 0 && styles.cardRoot]}
      >
        <View style={styles.head}>
          <AvatarInitials name={name} avatarUrl={person.avatarUrl} size={40} />
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          {reportCount > 0 && (
            <View style={styles.count} accessibilityLabel={L.admin.orgTree.reports(reportCount)}>
              <Ionicons name="people-outline" size={iconSize.xs} color={colors.primary} />
              <Text style={styles.countText}>{reportCount}</Text>
            </View>
          )}
        </View>
        <View style={styles.badges}>
          {person.roles.map((role) => <RoleBadge key={role} role={role} />)}
        </View>
      </Pressable>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  row: { flexDirection: rowDirectionStart, alignItems: 'flex-start', gap: spacing.xs, paddingVertical: spacing.xs },
  chevron: { width: spacing.xl, height: 40, alignItems: 'center', justifyContent: 'center' },
  card: {
    flex: 1, gap: spacing.sm, padding: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  cardRoot: { borderColor: colors.borderStrong },
  head: { flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.sm },
  name: { flex: 1, fontSize: typography.body.fontSize, ...typography.bold, color: colors.textPrimary, textAlign: textAlignStart() },
  count: {
    flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
    borderRadius: radius.full, backgroundColor: colors.primaryLight,
  },
  countText: { fontSize: typography.caption.fontSize, ...typography.extraBold, color: colors.primary },
  badges: { flexDirection: rowDirectionStart, flexWrap: 'wrap', gap: spacing.xs },
}));
