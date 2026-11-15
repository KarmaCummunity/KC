// FR-FEED-020 AC2 — the few community links shown at the end of a world's feed.
import { useQuery } from '@tanstack/react-query';
import { WORLD_LINKS_PREVIEW_COUNT, worldLinkListSlug, type DonationLink } from '@kc/domain';
import { container } from '../lib/container';
import { listOrEmpty } from '../lib/backendAvailability';

const STALE_MS = 5 * 60 * 1000;

/**
 * The first approved links of the world's community list, newest first. A world without a list
 * (items) and a failed read both yield no link: the footer still offers the full screen.
 */
export function useWorldLinksPreview(worldSlug: string): readonly DonationLink[] {
  const listSlug = worldLinkListSlug(worldSlug);
  const { data } = useQuery({
    queryKey: ['world-links-preview', listSlug],
    enabled: listSlug !== null,
    staleTime: STALE_MS,
    queryFn: async () => {
      if (!listSlug) return [];
      const links = await listOrEmpty(() => container.listDonationLinks.execute(listSlug));
      // The list also carries the member's own links that wait for review; the preview shows live ones only.
      return links.filter((link) => link.reviewStatus === 'approved').slice(0, WORLD_LINKS_PREVIEW_COUNT);
    },
  });
  return data ?? [];
}
