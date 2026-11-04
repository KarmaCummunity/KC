// app/apps/mobile/src/components/admin/admins/OrgTree.tsx
// FR-ADMIN-025 — collapsible org hierarchy tree. One section per org, one card per
// person (never one per role), reports nested under their manager behind a
// connector line. Trees are small (a single org's management chain), so plain
// recursion is enough — no virtualisation.
import { useState } from 'react';
import { View } from 'react-native';
import type { OrgPersonNode, OrgSection } from '@kc/domain';
import { makeUseStyles, spacing, Text, typography } from '@kc/ui';
import { OrgTreeRow } from './OrgTreeRow';
import { rowDirectionStart, textAlignStart } from '../../../lib/rtlLayout';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

export interface OrgTreeProps {
  readonly sections: readonly OrgSection[];
  readonly onSelect?: (userId: string) => void;
}

interface BranchProps {
  readonly node: OrgPersonNode;
  readonly collapsed: ReadonlySet<string>;
  readonly onToggle: (key: string) => void;
  readonly onSelect?: (userId: string) => void;
}

function Branch({ node, collapsed, onToggle, onSelect }: BranchProps) {
  const styles = useStyles();
  const isCollapsed = collapsed.has(node.person.key);
  return (
    <View>
      <OrgTreeRow node={node} collapsed={isCollapsed} onToggle={onToggle} onSelect={onSelect} />
      {node.children.length > 0 && !isCollapsed && (
        <View style={styles.children}>
          {node.children.map((child) => (
            <Branch key={child.person.key} node={child} collapsed={collapsed} onToggle={onToggle} onSelect={onSelect} />
          ))}
        </View>
      )}
    </View>
  );
}

export function OrgTree({ sections, onSelect }: OrgTreeProps) {
  const styles = useStyles();
  const L = useLocaleBundle();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  function toggle(key: string): void {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (sections.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{L.admin.admins.tree.empty}</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {sections.map((section) => (
        <View key={section.orgId ?? 'none'} style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionName} numberOfLines={1}>{section.orgName ?? L.admin.admins.tree.orgLabel}</Text>
            <Text style={styles.sectionCount}>{L.admin.orgTree.members(section.memberCount)}</Text>
          </View>
          {section.roots.map((root) => (
            <Branch key={root.person.key} node={root} collapsed={collapsed} onToggle={toggle} onSelect={onSelect} />
          ))}
        </View>
      ))}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root:      { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.lg },
  section:   { gap: spacing.xs },
  sectionHead: {
    flexDirection: rowDirectionStart, alignItems: 'baseline', justifyContent: 'space-between',
    gap: spacing.sm, paddingBottom: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  sectionName:  { flex: 1, fontSize: typography.h3.fontSize, ...typography.extraBold, color: colors.textPrimary, textAlign: textAlignStart() },
  sectionCount: { fontSize: typography.caption.fontSize, color: colors.textSecondary },
  // The line sits under the parent's chevron (spacing.xl wide, centred) and links its reports.
  children:  { marginStart: spacing.md, paddingStart: spacing.md, borderStartWidth: 2, borderStartColor: colors.border },
  empty:     { padding: spacing.xl, alignItems: 'center' },
  emptyText: { fontSize: typography.bodySmall.fontSize, color: colors.textSecondary, textAlign: 'center' },
}));
