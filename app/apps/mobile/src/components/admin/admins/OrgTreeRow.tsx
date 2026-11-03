// app/apps/mobile/src/components/admin/admins/OrgTreeRow.tsx
// FR-ADMIN-025 — a single, indented node row in the org hierarchy tree.
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { OrgTreeNode } from '@kc/domain';
import { iconSize, makeUseStyles, radius, spacing, Text, typography, useTheme } from '@kc/ui';
import { AvatarInitials } from '../../AvatarInitials';
import { RoleBadge } from './RoleBadge';
import { LevelBadge } from './LevelBadge';
import { rowDirectionStart, textAlignStart } from '../../../lib/rtlLayout';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

export interface OrgTreeRowProps {
  readonly node: OrgTreeNode;
  readonly hasChildren: boolean;
  readonly collapsed: boolean;
  readonly onToggle: (grantId: string) => void;
  readonly onSelect?: (userId: string) => void;
}

export function OrgTreeRow({ node, hasChildren, collapsed, onToggle, onSelect }: OrgTreeRowProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const L = useLocaleBundle();
  const { member, level } = node;
  const name = member.displayName ?? L.admin.admins.row.unnamed;

  return (
    <View style={[styles.row, { marginStart: level * 16 }]}>
      <Pressable
        accessibilityRole="button"
        hitSlop={6}
        onPress={() => (hasChildren ? onToggle(member.grantId) : undefined)}
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
        onPress={() => onSelect?.(member.userId)}
        style={styles.body}
      >
        <AvatarInitials name={name} avatarUrl={member.avatarUrl} size={32} />
        <View style={styles.texts}>
          <View style={styles.titleRow}>
            <Text style={styles.name} numberOfLines={1}>{name}</Text>
            <LevelBadge level={level} />
          </View>
          <View style={styles.badges}>
            <RoleBadge role={member.role} />
          </View>
        </View>
      </Pressable>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  row: {
    flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.xs,
    paddingVertical: spacing.xs, paddingHorizontal: spacing.sm,
  },
  chevron: { width: 20, alignItems: 'center', justifyContent: 'center' },
  body: {
    flex: 1, flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm,
  },
  texts: { flex: 1, gap: spacing.xs },
  titleRow: { flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.sm },
  name: { flex: 1, fontSize: typography.body.fontSize, ...typography.bold, color: colors.textPrimary, textAlign: textAlignStart() },
  badges: { flexDirection: rowDirectionStart, flexWrap: 'wrap', gap: spacing.xs },
}));
