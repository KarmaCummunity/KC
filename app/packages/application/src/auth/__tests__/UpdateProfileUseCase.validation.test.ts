import { describe, expect, it } from 'vitest';
import { UpdateProfileUseCase } from '../UpdateProfileUseCase';
import { FakeAuthService } from './fakeAuthService';
import { makeFakeUserRepo } from './onboardingFakeUserRepository';

const base = { sessionUserId: 'u-1', userId: 'u-1' } as const;
const setup = () => {
  const repo = makeFakeUserRepo({
    'u-1': { displayName: 'a', city: 'tlv', cityName: 'TLV', onboardingState: 'completed', biography: null },
  });
  return { repo, uc: new UpdateProfileUseCase(repo, new FakeAuthService()) };
};

describe('UpdateProfileUseCase field normalisation', () => {
  it('blank contact phone clears it; padded phone is trimmed', async () => {
    const { repo, uc } = setup();
    await uc.execute({ ...base, contactPhone: '   ' });
    expect(repo.rows.get('u-1')?.contactPhone).toBeNull();
    await uc.execute({ ...base, contactPhone: ' 050-1234567 ' });
    expect(repo.rows.get('u-1')?.contactPhone).toBe('050-1234567');
  });

  it('rejects over-long contact phone', async () => {
    const { uc } = setup();
    await expect(uc.execute({ ...base, contactPhone: '1'.repeat(21) })).rejects.toMatchObject({
      code: 'invalid_contact_phone',
    });
  });

  it.each([
    [{ street: 'Herzl', streetNumber: null }, 'incomplete_profile_address'],
    [{ street: '  ', streetNumber: '3' }, 'incomplete_profile_address'],
    [{ street: 'x'.repeat(81), streetNumber: '3' }, 'invalid_profile_street'],
    [{ street: 'Herzl', streetNumber: '3-b' }, 'invalid_profile_street_number'],
  ] as const)('rejects address %j', async (profileAddress, code) => {
    const { uc } = setup();
    await expect(uc.execute({ ...base, profileAddress })).rejects.toMatchObject({ code });
  });

  it('trims and stores a valid address, and clears it with nulls', async () => {
    const { repo, uc } = setup();
    await uc.execute({ ...base, profileAddress: { street: ' Herzl ', streetNumber: ' 12א ' } });
    expect(repo.rows.get('u-1')).toMatchObject({ profileStreet: 'Herzl', profileStreetNumber: '12א' });
    await uc.execute({ ...base, profileAddress: { street: null, streetNumber: null } });
    expect(repo.rows.get('u-1')).toMatchObject({ profileStreet: null, profileStreetNumber: null });
  });

  it('requires city and cityName together', async () => {
    const { uc } = setup();
    await expect(uc.execute({ ...base, city: 'haifa' })).rejects.toMatchObject({ code: 'city_pair_required' });
    await expect(uc.execute({ ...base, cityName: 'חיפה' })).rejects.toMatchObject({ code: 'city_pair_required' });
  });

  it('rejects an empty patch', async () => {
    const { uc } = setup();
    await expect(uc.execute({ ...base })).rejects.toMatchObject({ code: 'empty_patch' });
  });
});
