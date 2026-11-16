import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '@kc/domain';
import type { IListingStreetAddressRepository } from '../../ports/IListingStreetAddressRepository';
import { GetOwnListingStreetAddressUseCase, SaveListingStreetAddressUseCase } from '../listingStreetAddressUseCases';

function fakeRepo(): IListingStreetAddressRepository & { save: ReturnType<typeof vi.fn>; getOwn: ReturnType<typeof vi.fn> } {
  return {
    save: vi.fn().mockResolvedValue(undefined),
    getOwn: vi.fn().mockResolvedValue({ street: 'הרצל', streetNumber: '12' }),
  };
}

describe('SaveListingStreetAddressUseCase', () => {
  it('saves a valid address, trimmed', async () => {
    const repo = fakeRepo();
    await new SaveListingStreetAddressUseCase(repo).execute('L1', { street: ' הרצל ', streetNumber: ' 12 ' });
    expect(repo.save).toHaveBeenCalledWith('L1', { street: 'הרצל', streetNumber: '12' });
  });

  it('refuses a missing street or an invalid number before the round trip', async () => {
    const repo = fakeRepo();
    const save = new SaveListingStreetAddressUseCase(repo);
    await expect(save.execute('L1', { street: '', streetNumber: '12' })).rejects.toBeInstanceOf(ValidationError);
    await expect(save.execute('L1', { street: 'הרצל', streetNumber: 'abc' })).rejects.toBeInstanceOf(ValidationError);
    expect(repo.save).not.toHaveBeenCalled();
  });
});

describe('GetOwnListingStreetAddressUseCase', () => {
  it('returns what the repository stored for the owner', async () => {
    await expect(new GetOwnListingStreetAddressUseCase(fakeRepo()).execute('L1')).resolves.toEqual({
      street: 'הרצל',
      streetNumber: '12',
    });
  });
});
