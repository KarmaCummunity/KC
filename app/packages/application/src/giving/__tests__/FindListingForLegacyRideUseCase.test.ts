import { describe, expect, it, vi } from 'vitest';
import type { IRideLegacyLinkRepository } from '../../ports/IRideLegacyLinkRepository';
import { FindListingForLegacyRideUseCase } from '../FindListingForLegacyRideUseCase';

const RIDE = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

function makeRepo(result: string | null) {
  return { listingIdForLegacyRide: vi.fn<IRideLegacyLinkRepository['listingIdForLegacyRide']>(async () => result) } satisfies IRideLegacyLinkRepository;
}

describe('FindListingForLegacyRideUseCase', () => {
  it('finds the listing a legacy ride became', async () => {
    const repo = makeRepo('l1');
    await expect(new FindListingForLegacyRideUseCase(repo).execute(RIDE)).resolves.toBe('l1');
    expect(repo.listingIdForLegacyRide).toHaveBeenCalledWith(RIDE);
  });

  it.each([undefined, null, '', 'not-a-uuid'])('does not look up %s', async (id) => {
    const repo = makeRepo('l1');
    await expect(new FindListingForLegacyRideUseCase(repo).execute(id)).resolves.toBeNull();
    expect(repo.listingIdForLegacyRide).not.toHaveBeenCalled();
  });
});
