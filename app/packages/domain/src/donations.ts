// FR-DONATE-006..009 — donation categories + community-curated NGO links.
// Persisted in `donation_categories` + `donation_links` (migration 0014).
import type { DonationCategorySlug } from './value-objects';

export interface DonationCategory {
  readonly slug: DonationCategorySlug;
  readonly labelHe: string;
  readonly iconName: string;
  readonly sortOrder: number;
  readonly isActive: boolean;
}

/**
 * D9 — a suggested link goes live only after a reviewer (super admin or moderator) approves it.
 * The submitter sees their own pending or rejected link; everyone else sees approved links only.
 */
export type DonationLinkReviewStatus = 'pending' | 'approved' | 'rejected';

export interface DonationLink {
  readonly id: string;
  readonly categorySlug: DonationCategorySlug;
  readonly url: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly submittedBy: string | null;
  readonly validatedAt: string;
  readonly createdAt: string;
  /** D9 review state; a content edit sends an approved link back to 'pending'. */
  readonly reviewStatus: DonationLinkReviewStatus;
  /** The reviewer's optional reason, set on rejection. */
  readonly reviewNote: string | null;
}
