// §5.11 (#1476) — the admin portal's job-posting switch: every organization with whether it may
// publish job offers, and the switch that writes it. The member's own job-offer form reads the
// same fact through their organizations, so its query is refreshed after a change.
import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { orgJobPostingAdminUseCases } from '../services/orgJobPostingAdminComposition';
import { MY_ORGANIZATIONS_QUERY_KEY } from '../services/eventRegistrationComposition';

export const ORG_JOB_POSTING_QUERY_KEY = ['admin', 'org-job-posting'] as const;

export function useOrgJobPostingAdmin(enabled: boolean) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ORG_JOB_POSTING_QUERY_KEY,
    queryFn: () => orgJobPostingAdminUseCases.list().execute(),
    enabled,
  });
  // The organization whose write is running, so its row shows a spinner and blocks a second press.
  const [busyOrgId, setBusyOrgId] = useState<string | null>(null);

  /** Switches one organization; resolves false when the server refused it, so the screen can say so. */
  const setMayPostJobs = useCallback(
    async (orgId: string, mayPostJobs: boolean): Promise<boolean> => {
      setBusyOrgId(orgId);
      try {
        await orgJobPostingAdminUseCases.set().execute({ orgId, enabled: mayPostJobs });
        await queryClient.invalidateQueries({ queryKey: ORG_JOB_POSTING_QUERY_KEY });
        await queryClient.invalidateQueries({ queryKey: MY_ORGANIZATIONS_QUERY_KEY });
        return true;
      } catch {
        return false;
      } finally {
        setBusyOrgId(null);
      }
    },
    [queryClient],
  );

  return {
    organizations: query.data ?? [],
    loading: query.isLoading,
    failed: query.isError,
    busyOrgId,
    setMayPostJobs,
  };
}
