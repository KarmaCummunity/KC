// FR-FIN-022 — public, live financial transparency of an organization (platform org by default).
import { useQuery } from '@tanstack/react-query';
import type { OrgTransparency } from '@kc/domain';
import { getOrgTransparencyUseCase } from '../services/transparencyComposition';

export function useOrgTransparency(slug?: string) {
  return useQuery<OrgTransparency>({
    queryKey: ['org-transparency', slug ?? 'platform'],
    queryFn: () => getOrgTransparencyUseCase().execute(slug),
    // Figures change whenever the treasurer saves an entry; a short stale window keeps them live
    // without refetching on every re-render.
    staleTime: 60_000,
  });
}
