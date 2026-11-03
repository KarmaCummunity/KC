// app/apps/mobile/src/hooks/useAdminRoleMutations.ts
// FR-ADMIN-016 / FR-ADMIN-030 — grant, revoke and change-role mutations with
// cache invalidation.
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { GrantableAdminRole } from '@kc/domain';
import { container } from '../lib/container';

export interface GrantAdminRoleVars {
  readonly targetUserId: string;
  readonly role: GrantableAdminRole;
  /** Org the role applies to; null for platform roles. */
  readonly scopeOrgId: string | null;
}

export interface ChangeAdminRoleVars {
  readonly grantId: string;
  readonly newRole: GrantableAdminRole;
}

/** Every view that reads grants: the roster, the viewer's own roles, and the
 *  tree + layered hierarchy views (FR-ADMIN-025/028). */
function invalidateTeam(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ['admin.admins.list'] });
  void qc.invalidateQueries({ queryKey: ['admin.roles'] });
  void qc.invalidateQueries({ queryKey: ['admin.org.tree'] });
}

export function useGrantAdminRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: GrantAdminRoleVars) => container.grantAdminRole.execute(vars),
    onSuccess: () => invalidateTeam(qc),
  });
}

export function useRevokeAdminRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (grantId: string) => container.revokeAdminRole.execute({ grantId }),
    onSuccess: () => invalidateTeam(qc),
  });
}

export function useChangeAdminRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: ChangeAdminRoleVars) => container.changeAdminRole.execute(vars),
    onSuccess: () => invalidateTeam(qc),
  });
}
