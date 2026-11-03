// app/apps/mobile/src/components/admin/admins/AdminsTreeView.tsx
// FR-ADMIN-025 — the "tree" tab of the admins screen: org switcher (super_admin)
// + collapsible hierarchy. Split out of the screen to keep each unit small.
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView } from 'react-native';
import { makeUseStyles, spacing } from '@kc/ui';
import { useOrgTree } from '../../../hooks/useOrgTree';
import { OrgTree } from './OrgTree';
import { OrgSwitcher, type OrgOption } from './OrgSwitcher';

export interface AdminsTreeViewProps {
  readonly isWide: boolean;
  readonly isSuper: boolean;
  readonly onSelect: (userId: string) => void;
}

function distinctOrgs(
  members: readonly { orgId: string | null; orgName: string | null }[],
): OrgOption[] {
  const seen = new Map<string, string>();
  for (const m of members) {
    if (m.orgId !== null && !seen.has(m.orgId)) seen.set(m.orgId, m.orgName ?? m.orgId);
  }
  return [...seen].map(([id, name]) => ({ id, name }));
}

export function AdminsTreeView({ isWide, isSuper, onSelect }: AdminsTreeViewProps) {
  const styles = useStyles();
  const [orgId, setOrgId] = useState<string | null>(null);
  const tree = useOrgTree(orgId);
  const orgs = useMemo(() => distinctOrgs(tree.members), [tree.members]);
  const showSwitcher = isSuper && orgs.length > 1;

  return (
    <ScrollView
      contentContainerStyle={[styles.content, isWide && styles.contentWide]}
      refreshControl={<RefreshControl refreshing={tree.isRefetching} onRefresh={tree.refetch} />}
    >
      {showSwitcher && <OrgSwitcher orgs={orgs} selected={orgId} onSelect={setOrgId} />}
      <OrgTree forest={tree.forest} onSelect={onSelect} />
    </ScrollView>
  );
}

const useStyles = makeUseStyles(() => ({
  content:     { paddingBottom: spacing.xl },
  contentWide: { width: '100%', maxWidth: 760, alignSelf: 'center' },
}));
