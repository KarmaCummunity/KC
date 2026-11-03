// useDonationLinkReview — D9: the reviewer's donation-link queue for one status, and the
// approve / reject decision. The server checks the reviewer role (0546); the screen gates on the
// 'donation_links.review' permission so a member never sees the screen at all.

import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DonationLinkReviewStatus } from '@kc/domain';
import { container } from '../lib/container';

export const DONATION_LINK_REVIEW_QUERY_KEY = 'admin.donation-links';

export function useDonationLinkReview(status: DonationLinkReviewStatus, enabled: boolean) {
  const queryClient = useQueryClient();
  // The link whose decision is running, so its row can disable its buttons.
  const [busyId, setBusyId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: [DONATION_LINK_REVIEW_QUERY_KEY, status],
    queryFn: () => container.listDonationLinksForReview.execute(status),
    enabled,
  });

  /** Approves or rejects one link; resolves false when the server refused it. */
  const decide = useCallback(
    async (linkId: string, approve: boolean, note?: string | null): Promise<boolean> => {
      setBusyId(linkId);
      try {
        await container.reviewDonationLink.execute({ linkId, approve, note });
        // The link leaves this tab and enters another (public lists refetch on their own mount).
        await queryClient.invalidateQueries({ queryKey: [DONATION_LINK_REVIEW_QUERY_KEY] });
        return true;
      } catch {
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [queryClient],
  );

  return {
    items: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    isRefetching: query.isRefetching,
    busyId,
    decide,
  };
}
