/**
 * FR-ADMIN-009 — UI-only convenience flag. The server re-checks via
 * is_admin(auth.uid()) inside the admin_remove_post RPC, so a tampered
 * client cannot escalate. We cache for the session lifetime — admin
 * promotion is a manual SQL operation that requires a session restart
 * to take effect anyway.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/container';
import { useAuthStore } from '../store/authStore';

async function fetchIsSuperAdmin(userId: string): Promise<boolean> {
  // TD-163: the `is_super_admin` column is no longer client-readable (migration
  // 0163 revoked the SELECT grant). Resolve admin status via the SECURITY
  // DEFINER is_admin(uid) RPC. The hook fails closed (non-admin) while the query has no data;
  // the error is thrown, not returned as `false`, so a transient failure is never cached
  // forever by `staleTime: Infinity` and the query is retried on the next mount.
  const { data, error } = await supabase.rpc('is_admin', { uid: userId });
  if (error) throw error;
  return data === true;
}

export function useIsSuperAdmin(): boolean {
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const { data } = useQuery({
    queryKey: ['users.is_super_admin', userId],
    queryFn: () => fetchIsSuperAdmin(userId as string),
    enabled: userId !== null,
    staleTime: Infinity,
  });
  return data === true;
}
