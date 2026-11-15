// D9: a suggested donation link is reviewed while the review graph still lets a reviewer decide it.
import { describe, expect, it } from 'vitest';
import { isDonationLinkAwaitingReview } from '../donations';
import { donationLinkReviewMachine } from '../fsm/machines/donationLinkReview';

describe('isDonationLinkAwaitingReview', () => {
  it('is true only for a pending link', () => {
    expect(donationLinkReviewMachine.states.filter((status) => isDonationLinkAwaitingReview(status))).toEqual(['pending']);
  });

  it('is false for a status the app does not know', () => {
    expect(isDonationLinkAwaitingReview('a_newer_status')).toBe(false);
  });
});
