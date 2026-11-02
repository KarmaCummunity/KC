// #1412 — listing action failures: known server codes map to their own copy; anything else keeps
// the generic copy.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../observability/sentry', () => ({ getSentryIfInit: () => null }));

import { LISTING_ACTION_FAILED_KEY, listingActionErrorKey, reportListingActionError } from '../listingActionError';

describe('listingActionErrorKey', () => {
  it.each([
    ['auth_required', 'marketplace.actionErrors.signInRequired'],
    ['account_not_active', 'marketplace.actionErrors.accountNotActive'],
    ['forbidden', 'marketplace.actionErrors.listingUnavailable'],
    ['cannot_chat_self', 'marketplace.actionErrors.ownListing'],
  ])('maps the server code %s to its copy', (code, key) => {
    expect(listingActionErrorKey({ message: code, code: 'P0001' })).toBe(key);
  });

  it('keeps the generic copy for an unknown code, a non-error and no error at all', () => {
    expect(listingActionErrorKey(new Error('network request failed'))).toBe(LISTING_ACTION_FAILED_KEY);
    expect(listingActionErrorKey('boom')).toBe(LISTING_ACTION_FAILED_KEY);
    expect(listingActionErrorKey(null)).toBe(LISTING_ACTION_FAILED_KEY);
    expect(listingActionErrorKey({ message: 42 })).toBe(LISTING_ACTION_FAILED_KEY);
  });

  it('does not throw when reporting while Sentry is not initialised', () => {
    expect(() => reportListingActionError('start_chat', new Error('x'))).not.toThrow();
  });
});
