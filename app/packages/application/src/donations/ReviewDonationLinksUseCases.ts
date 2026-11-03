// D9 (docs/spec/08_organizations.md) — a suggested donation link goes live only after a reviewer
// approves it. The reviewer's queue and decision; authorization is enforced server-side
// (is_donation_link_reviewer, migration 0546), these use cases validate input only.
import type { DonationLinkReviewStatus } from '@kc/domain';
import type { DonationLinkReviewItem, IDonationLinksRepository } from '../ports/IDonationLinksRepository';
import { DonationLinkError } from './errors';

/** A rejection note is stored up to this length (donation_links_review_note_length, 0546). */
export const DONATION_LINK_REVIEW_NOTE_MAX = 280;

export class ListDonationLinksForReviewUseCase {
  constructor(private readonly repo: IDonationLinksRepository) {}

  /** The links in `status`, oldest first, so the queue is worked in arrival order. */
  execute(status: DonationLinkReviewStatus = 'pending'): Promise<DonationLinkReviewItem[]> {
    return this.repo.listForReview(status);
  }
}

export interface ReviewDonationLinkInput {
  readonly linkId: string;
  readonly approve: boolean;
  /** Optional reason for a rejection; ignored on approval. */
  readonly note?: string | null;
}

export class ReviewDonationLinkUseCase {
  constructor(private readonly repo: IDonationLinksRepository) {}

  async execute(input: ReviewDonationLinkInput): Promise<DonationLinkReviewStatus> {
    if (!input.linkId) throw new DonationLinkError('invalid_input', 'linkId is required');
    // An approval carries no note; a blank note is no note.
    const note = input.approve ? null : (input.note ?? '').trim() || null;
    if (note && note.length > DONATION_LINK_REVIEW_NOTE_MAX) {
      throw new DonationLinkError('invalid_input', `note longer than ${DONATION_LINK_REVIEW_NOTE_MAX}`);
    }
    return this.repo.review(input.linkId, input.approve, note);
  }
}
