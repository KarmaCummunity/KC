// app/apps/mobile/src/hooks/useMoneyPermissions.ts
// FR-FIN-002 — what the viewer may do in the finance area, from their staff roles. Mirrors
// kc_private.finance_assert: `view` reads the books, `manage` writes entries and accounts,
// `transparency` opens the donors overview and the public switches.
import { hasPermission, type AdminRole } from '@kc/domain';
import { useAdminRoles } from './useAdminRoles';

export interface MoneyPermissions {
  readonly isLoading: boolean;
  readonly canView: boolean;
  readonly canManage: boolean;
  readonly canTransparency: boolean;
}

export function useMoneyPermissions(): MoneyPermissions {
  const { roles, isLoading } = useAdminRoles();
  const typed = roles as readonly AdminRole[];
  return {
    isLoading,
    canView: hasPermission(typed, 'money.view'),
    canManage: hasPermission(typed, 'money.manage'),
    canTransparency: hasPermission(typed, 'money.transparency'),
  };
}
