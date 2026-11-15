// app/apps/mobile/src/hooks/useSetOrgSlug.ts
// FR-ORG-001 AC5 (PM decision) — the super admin changes an organization's page slug. The
// hierarchy snapshot carries the slug, so it is refreshed after a change.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { container } from '../lib/container';

export interface SetOrgSlugVars {
  readonly orgId: string;
  readonly slug: string;
}

export function useSetOrgSlug() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: SetOrgSlugVars) => container.setOrgSlug.execute(vars),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin.org.tree'] });
    },
  });
}
