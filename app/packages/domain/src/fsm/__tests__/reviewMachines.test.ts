import { describe, expect, it } from 'vitest';
import { canTransition, isTerminal } from '../machine';
import { donationLinkReviewMachine } from '../machines/donationLinkReview';
import { reviewDecisionMachine } from '../machines/reviewDecision';

describe('review decision machine', () => {
  it('decides a pending item once', () => {
    expect(canTransition(reviewDecisionMachine, 'pending', 'approved').ok).toBe(true);
    expect(canTransition(reviewDecisionMachine, 'pending', 'rejected').ok).toBe(true);
    expect(canTransition(reviewDecisionMachine, 'approved', 'rejected')).toEqual({ ok: false, code: 'illegal_transition' });
    expect(canTransition(reviewDecisionMachine, 'rejected', 'pending').ok).toBe(false);
    expect(isTerminal(reviewDecisionMachine, 'approved')).toBe(true);
    expect(isTerminal(reviewDecisionMachine, 'rejected')).toBe(true);
  });
});

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
