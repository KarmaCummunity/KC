// app/apps/mobile/src/components/admin/admins/OrgTree.tsx
// FR-ADMIN-025 — collapsible org hierarchy tree. Flattens the forest into the
// currently-visible rows (respecting per-node collapse state) and renders them
// indented by level. Trees are small (a single org's management chain), so a
// plain mapped list is sufficient — no nested virtualisation.
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import type { OrgTreeNode } from '@kc/domain';
import { makeUseStyles, spacing, Text, typography } from '@kc/ui';
import { OrgTreeRow } from './OrgTreeRow';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

export interface OrgTreeProps {
  readonly forest: readonly OrgTreeNode[];
  readonly onSelect?: (userId: string) => void;
}

interface FlatRow {
  readonly node: OrgTreeNode;
  readonly hasChildren: boolean;
  readonly collapsed: boolean;
}

function flatten(
  forest: readonly OrgTreeNode[],
  collapsed: ReadonlySet<string>,
  out: FlatRow[],
): void {
  for (const node of forest) {
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.has(node.member.grantId);
    out.push({ node, hasChildren, collapsed: isCollapsed });
    if (hasChildren && !isCollapsed) flatten(node.children, collapsed, out);
  }
}

export function OrgTree({ forest, onSelect }: OrgTreeProps) {
  const styles = useStyles();
  const L = useLocaleBundle();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const rows = useMemo(() => {
    const out: FlatRow[] = [];
    flatten(forest, collapsed, out);
    return out;
  }, [forest, collapsed]);

  function toggle(grantId: string): void {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(grantId)) next.delete(grantId);
      else next.add(grantId);
      return next;
    });
  }

  if (forest.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{L.admin.admins.tree.empty}</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {rows.map((r) => (
        <OrgTreeRow
          key={r.node.member.grantId}
          node={r.node}
          hasChildren={r.hasChildren}
          collapsed={r.collapsed}
          onToggle={toggle}
          onSelect={onSelect}
        />
      ))}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root:      { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  empty:     { padding: spacing.xl, alignItems: 'center' },
  emptyText: { fontSize: typography.bodySmall.fontSize, color: colors.textSecondary, textAlign: 'center' },
}));
