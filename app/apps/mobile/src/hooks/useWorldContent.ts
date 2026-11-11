// FR-FEED-020 AC2 — the curated links and knowledge of a giving world (migration 0003).
import { useQuery } from '@tanstack/react-query';
import { emptyWorldContent, type WorldContent } from '@kc/domain';
import { worldContentContainer } from '../lib/worldContentContainer';
import { isBackendUnavailable } from '../lib/backendAvailability';

/** Curated content changes rarely; one read serves the feed footer and the dedicated screen. */
const STALE_MS = 10 * 60 * 1000;

/** Reads a world's content; a backend that does not have the tables yet counts as "nothing curated". */
async function loadWorldContent(worldSlug: string): Promise<WorldContent> {
  try {
    return await worldContentContainer.getWorldContent.execute(worldSlug);
  } catch (error) {
    if (isBackendUnavailable(error)) return emptyWorldContent(worldSlug);
    throw error;
  }
}

export interface WorldContentState {
  /** The world's content; empty lists while it loads or when the world has none. */
  readonly content: WorldContent;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly retry: () => void;
}

export function useWorldContent(worldSlug: string): WorldContentState {
  const query = useQuery({
    queryKey: ['world-content', worldSlug],
    queryFn: () => loadWorldContent(worldSlug),
    staleTime: STALE_MS,
  });
  return {
    content: query.data ?? emptyWorldContent(worldSlug),
    isLoading: query.isLoading,
    isError: query.isError,
    retry: () => void query.refetch(),
  };
}
