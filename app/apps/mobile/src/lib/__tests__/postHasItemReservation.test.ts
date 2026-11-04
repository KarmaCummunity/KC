// G1 step 4b (ADR-006) — which posts carry the item reservation on their own page.
import { describe, expect, it } from 'vitest';
import { postHasItemReservation } from '../postHasItemReservation';

describe('postHasItemReservation', () => {
  it('is on for a giving post made through the post form, open or delivered', () => {
    expect(postHasItemReservation({ type: 'Give', listingId: null, status: 'open' })).toBe(true);
    // Delivered: both sides still rate the hand-over.
    expect(postHasItemReservation({ type: 'Give', listingId: null, status: 'closed_delivered' })).toBe(true);
  });

  it('is off for a request, a listing-world post or a post that can no longer be acted on', () => {
    expect(postHasItemReservation({ type: 'Request', listingId: null, status: 'open' })).toBe(false);
    // A listing-world post shows the listing's own actions instead (4a).
    expect(postHasItemReservation({ type: 'Give', listingId: 'l_1', status: 'open' })).toBe(false);
    expect(postHasItemReservation({ type: 'Give', listingId: null, status: 'deleted_no_recipient' })).toBe(false);
    expect(postHasItemReservation({ type: 'Give', listingId: null, status: 'removed_admin' })).toBe(false);
  });
});
