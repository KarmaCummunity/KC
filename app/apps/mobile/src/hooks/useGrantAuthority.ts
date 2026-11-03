// app/apps/mobile/src/hooks/useGrantAuthority.ts
// FR-ADMIN-030 — the viewer's grant authority for the team-management UI.
//
// Combines the viewer's own active grants and the reporting tree (from the
// RBAC-scoped org tree) with the orgs they can see (from the hierarchy census),
// so screens offer only what the server's authority rules accept
// (`can_grant_role`, `can_manage_grant`; FR-ADMIN-027).
import { useMemo } from 'react';
import { grantableRolesIn, type ViewerAuthority } from '@kc/domain';
import { useAuthStore } from '../store/authStore';
import { useOrgTree } from './useOrgTree';
import { useHierarchyPyramid } from './useHierarchyPyramid';

/** A place a role can be granted: the platform (scope null) or one org. */
export interface GrantScopeOption {
  readonly scopeOrgId: string | null;
  readonly name: string;
}

export interface GrantAuthorityState {
  readonly authority: ViewerAuthority;
  /** Scopes in which the viewer may grant at least one role, platform first. */
  readonly scopes: readonly GrantScopeOption[];
  readonly isLoading: boolean;
}

export function useGrantAuthority(): GrantAuthorityState {
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const tree = useOrgTree(null, userId !== null);
  const { pyramid } = useHierarchyPyramid(null);

  const authority = useMemo<ViewerAuthority>(() => ({
    userId: userId ?? '',
    grants: tree.members.filter((m) => m.userId === userId),
    managerOf: new Map(tree.members.map((m) => [m.grantId, m.managerGrantId])),
  }), [tree.members, userId]);

  const scopes = useMemo<GrantScopeOption[]>(() => {
    // The platform org row stands for platform grants, whose scope is null.
    const options = (pyramid?.orgs ?? []).map((org) => ({
      scopeOrgId: org.isPlatform ? null : org.orgId,
      name: org.name,
    }));
    return options.filter((o) => grantableRolesIn(authority.grants, o.scopeOrgId).length > 0);
  }, [pyramid?.orgs, authority.grants]);

  return { authority, scopes, isLoading: tree.isLoading || pyramid === null };
}
