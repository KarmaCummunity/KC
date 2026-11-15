import { describe, expect, it } from 'vitest';
import { canTransition } from '../machine';
import { donationLinkReviewMachine } from '../machines/donationLinkReview';
import { reviewDecisionMachine } from '../machines/reviewDecision';

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

describe('review decision machine (WhatsApp bot posts)', () => {
  it('decides a pending item either way', () => {
    expect(canTransition(reviewDecisionMachine, 'pending', 'approved').ok).toBe(true);
    expect(canTransition(reviewDecisionMachine, 'pending', 'rejected').ok).toBe(true);
  });

  it('keeps both decisions final', () => {
    expect(canTransition(reviewDecisionMachine, 'approved', 'pending').ok).toBe(false);
    expect(canTransition(reviewDecisionMachine, 'rejected', 'approved').ok).toBe(false);
  });
});
