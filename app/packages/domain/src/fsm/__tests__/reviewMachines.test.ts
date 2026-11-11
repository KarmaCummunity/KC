import { describe, expect, it } from 'vitest';
import { canTransition } from '../machine';
import { donationLinkReviewMachine } from '../machines/donationLinkReview';

describe('donation link review machine', () => {
  it('sends an edited link back to review from either decision', () => {
    expect(canTransition(donationLinkReviewMachine, 'approved', 'pending').ok).toBe(true);
    expect(canTransition(donationLinkReviewMachine, 'rejected', 'pending').ok).toBe(true);
  });

  it('never flips a decision without a new review', () => {
    expect(canTransition(donationLinkReviewMachine, 'approved', 'rejected').ok).toBe(false);
    expect(canTransition(donationLinkReviewMachine, 'rejected', 'approved').ok).toBe(false);
  });
});
