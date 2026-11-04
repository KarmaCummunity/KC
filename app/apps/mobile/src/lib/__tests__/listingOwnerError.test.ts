import { describe, expect, it } from 'vitest';
import { listingOwnerErrorKey } from '../listingOwnerError';

describe('listingOwnerErrorKey', () => {
  it('maps every owner-action refusal code to its message', () => {
    expect(listingOwnerErrorKey({ message: 'listing_has_active_handoff', code: '23514' })).toBe(
      'marketplace.myListingsErrorActiveHandoff',
    );
    expect(listingOwnerErrorKey(new Error('listing_has_handoff_history'))).toBe(
      'marketplace.myListingsErrorHandoffHistory',
    );
    expect(listingOwnerErrorKey({ message: 'listing_expired' })).toBe('marketplace.myListingsErrorExpired');
    expect(listingOwnerErrorKey({ message: 'listing_media_full' })).toBe('marketplace.myListingsErrorMediaFull');
    expect(listingOwnerErrorKey({ message: 'listing_not_editable' })).toBe('marketplace.myListingsErrorNotEditable');
    expect(listingOwnerErrorKey({ message: 'listing_wrong_status' })).toBe('marketplace.myListingsErrorWrongStatus');
    expect(listingOwnerErrorKey({ message: 'listing_not_found' })).toBe('marketplace.myListingsErrorNotFound');
  });

  it('falls back to the generic message, never a raw server text', () => {
    expect(listingOwnerErrorKey({ message: 'duplicate key value violates unique constraint' })).toBe(
      'marketplace.myListingsErrorGeneric',
    );
    expect(listingOwnerErrorKey(null)).toBe('marketplace.myListingsErrorGeneric');
    expect(listingOwnerErrorKey('listing_expired')).toBe('marketplace.myListingsErrorGeneric');
  });
});
