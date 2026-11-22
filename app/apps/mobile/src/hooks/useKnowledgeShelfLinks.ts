// FR-KNOW-012 AC2 — official body links configured for a knowledge shelf.
import { useQuery } from '@tanstack/react-query';
import type { KnowledgeShelfLink } from '@kc/domain';
import { worldContentContainer } from '../lib/worldContentContainer';
import { isBackendUnavailable } from '../lib/backendAvailability';

const STALE_MS = 10 * 60 * 1000;

async function loadShelfLinks(shelfSlug: string): Promise<readonly KnowledgeShelfLink[]> {
  try {
    return await worldContentContainer.listKnowledgeShelfLinks.execute(shelfSlug);
  } catch (error) {
    if (isBackendUnavailable(error)) return [];
    throw error;
  }
}

/** Active official links for one shelf; empty while loading or when none are configured. */
export function useKnowledgeShelfLinks(shelfSlug: string | null) {
  const query = useQuery({
    queryKey: ['knowledge-shelf-links', shelfSlug],
    queryFn: () => loadShelfLinks(shelfSlug!),
    enabled: Boolean(shelfSlug),
    staleTime: STALE_MS,
  });
  return {
    links: query.data ?? [],
    isLoading: query.isLoading,
  };
}
