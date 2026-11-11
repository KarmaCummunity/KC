import type { DonationLink, DonationCategorySlug, DonationLinkReviewStatus } from '@kc/domain';

/** D9 — one suggested link as the reviewer's queue shows it. */
export interface DonationLinkReviewItem {
  readonly id: string;
  readonly categorySlug: DonationCategorySlug;
  readonly url: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly submittedBy: string | null;
  readonly submitterName: string | null;
  readonly reviewStatus: DonationLinkReviewStatus;
  readonly reviewNote: string | null;
  readonly createdAt: string;
}

export interface AddDonationLinkInput {
  readonly categorySlug: DonationCategorySlug;
  readonly url: string;
  readonly displayName: string;
  readonly description?: string | null;
}

export interface UpdateDonationLinkInput {
  readonly linkId: string;
  readonly categorySlug: DonationCategorySlug;
  readonly url: string;
  readonly displayName: string;
  readonly description?: string | null;
}

export interface IDonationLinksRepository {
  /** Approved links of a category plus the caller's own, newest first. */
  listByCategory(slug: DonationCategorySlug): Promise<DonationLink[]>;

  /** Calls the validate-donation-link Edge Function. The function performs URL
   *  reachability checks and inserts via service-role on success. */
  addViaEdgeFunction(input: AddDonationLinkInput): Promise<DonationLink>;

  /** Same Edge Function with `link_id`: validates URL, then updates the row if
   *  the caller is the submitter and the row is visible. */
  updateViaEdgeFunction(input: UpdateDonationLinkInput): Promise<DonationLink>;

  /** Permanently deletes the row. Authorization (own-row or super-admin) is
   *  enforced by RLS (`donation_links_delete_own_or_admin`). */
  deleteById(linkId: string): Promise<void>;

  /** Sends a system message about a donation link to the reporter's support
   *  thread. Server-side resolves the reporter via auth.uid() and the link
   *  URL/name from the DB; client must be signed in. FR-DONATE AC2. */
  report(linkId: string): Promise<void>;

  /** D9 — reviewer only: links in `status`, oldest first (`admin_list_donation_links_for_review`). */
  listForReview(status: DonationLinkReviewStatus): Promise<DonationLinkReviewItem[]>;

  /** D9 — reviewer only: approve or reject a pending link; a rejection may carry a short note. */
  review(linkId: string, approve: boolean, note?: string | null): Promise<DonationLinkReviewStatus>;
}
