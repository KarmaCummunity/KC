import { describe, expect, it } from 'vitest';
import { CompleteBasicInfoUseCase } from '../CompleteBasicInfoUseCase';
import { OnboardingError, ProfileError } from '../errors';
import { FakeAuthService } from './fakeAuthService';
import { makeFakeUserRepo } from './onboardingFakeUserRepository';

function makeUc(repo: ReturnType<typeof makeFakeUserRepo>, auth = new FakeAuthService()) {
  return new CompleteBasicInfoUseCase(repo, auth, NOW);
}

/** 18+ on the fixed clock below. */
const DOB = '1990-05-15';
const NOW = () => new Date(2026, 10, 3);

describe('CompleteBasicInfoUseCase', () => {
  const userId = 'user-1';

  const seed = () =>
    makeFakeUserRepo({
      [userId]: {
        displayName: 'placeholder',
        city: '5000',
        onboardingState: 'pending_basic_info',
      },
    });

  it('persists trimmed display_name + city id (not the name) and advances state to pending_avatar', async () => {
    const repo = seed();
    const useCase = makeUc(repo);

    await useCase.execute({ sessionUserId: userId,
      userId,
      displayName: '  נווה  ',
      cityId: '4000',
      cityName: 'חיפה',
      dateOfBirth: DOB,
    });

    expect(repo.rows.get(userId)).toEqual({
      displayName: 'נווה',
      city: '4000',
      onboardingState: 'pending_avatar',
      basicInfoSkipped: false,
      profileStreet: null,
      profileStreetNumber: null,
      contactPhone: null,
      dateOfBirth: DOB,
    });
  });

  it('persists trimmed optional contact phone (FR-AUTH-010 AC2.c)', async () => {
    const repo = seed();
    const useCase = makeUc(repo);

    await useCase.execute({ sessionUserId: userId,
      userId,
      displayName: 'נווה',
      cityId: '4000',
      cityName: 'חיפה',
      dateOfBirth: DOB,
      contactPhone: '  050-1234567 ',
    });

    expect(repo.rows.get(userId)?.contactPhone).toBe('050-1234567');
  });

  it('clears contact phone when whitespace-only is submitted', async () => {
    const repo = seed();
    const useCase = makeUc(repo);

    await useCase.execute({ sessionUserId: userId,
      userId,
      displayName: 'נווה',
      cityId: '4000',
      cityName: 'חיפה',
      dateOfBirth: DOB,
      contactPhone: '   ',
    });

    expect(repo.rows.get(userId)?.contactPhone).toBeNull();
  });

  it('rejects contact phone longer than 20 chars after trim', async () => {
    const useCase = makeUc(seed());

    await expect(
      useCase.execute({ sessionUserId: userId,
        userId,
        displayName: 'נווה',
        cityId: '4000',
        cityName: 'חיפה',
        dateOfBirth: DOB,
        contactPhone: '1234567890123456789012',
      }),
    ).rejects.toThrow('invalid_contact_phone');
  });

  it('throws typed ProfileError (not raw Error) for field validation failures (§5 invariant)', async () => {
    const useCase = makeUc(seed());

    await expect(
      useCase.execute({ sessionUserId: userId, userId, displayName: '   ', cityId: '4000', cityName: 'חיפה' , dateOfBirth: DOB}),
    ).rejects.toMatchObject({
      name: 'ProfileError',
      code: 'invalid_display_name',
    } satisfies Partial<ProfileError>);

    await expect(
      useCase.execute({ sessionUserId: userId, userId, displayName: 'נווה', cityId: '', cityName: 'חיפה' , dateOfBirth: DOB}),
    ).rejects.toBeInstanceOf(ProfileError);

    await expect(
      useCase.execute({ sessionUserId: userId,
        userId,
        displayName: 'נווה',
        cityId: '4000',
        cityName: 'חיפה',
        dateOfBirth: DOB,
        contactPhone: '1234567890123456789012',
      }),
    ).rejects.toMatchObject({ name: 'ProfileError', code: 'invalid_contact_phone' });
  });

  it('rejects whitespace-only display_name (FR-AUTH-010 AC1)', async () => {
    const useCase = makeUc(seed());

    await expect(
      useCase.execute({ sessionUserId: userId, userId, displayName: '   ', cityId: '4000', cityName: 'חיפה' , dateOfBirth: DOB}),
    ).rejects.toThrowError(/display_name/);
  });

  it('rejects display_name longer than 50 chars (FR-AUTH-010 AC1)', async () => {
    const useCase = makeUc(seed());

    await expect(
      useCase.execute({ sessionUserId: userId,
        userId,
        displayName: 'a'.repeat(51),
        cityId: '4000',
        cityName: 'חיפה',
        dateOfBirth: DOB,
      }),
    ).rejects.toThrowError(/display_name/);
  });

  it('rejects empty cityId or cityName (boundary input from picker)', async () => {
    const useCase = makeUc(seed());

    await expect(
      useCase.execute({ sessionUserId: userId, userId, displayName: 'נווה', cityId: '', cityName: 'חיפה' , dateOfBirth: DOB}),
    ).rejects.toThrowError(/city/);

    await expect(
      useCase.execute({ sessionUserId: userId, userId, displayName: 'נווה', cityId: '4000', cityName: '   ' , dateOfBirth: DOB}),
    ).rejects.toThrowError(/city/);
  });

  it('persists optional profile street + number (FR-PROFILE-007 shape)', async () => {
    const repo = seed();
    const useCase = makeUc(repo);

    await useCase.execute({ sessionUserId: userId,
      userId,
      displayName: 'נווה',
      cityId: '4000',
      cityName: 'חיפה',
      dateOfBirth: DOB,
      profileStreet: '  הרצל ',
      profileStreetNumber: ' 12 ',
    });

    expect(repo.rows.get(userId)).toMatchObject({
      displayName: 'נווה',
      city: '4000',
      profileStreet: 'הרצל',
      profileStreetNumber: '12',
      onboardingState: 'pending_avatar',
    });
  });

  it('rejects street without number', async () => {
    const useCase = makeUc(seed());

    await expect(
      useCase.execute({ sessionUserId: userId,
        userId,
        displayName: 'נווה',
        cityId: '4000',
        cityName: 'חיפה',
        dateOfBirth: DOB,
        profileStreet: 'הרצל',
        profileStreetNumber: '',
      }),
    ).rejects.toThrow('incomplete_profile_address');
  });

  it('accepts profile street number with Hebrew letter suffix (audit §3.1)', async () => {
    const repo = seed();
    const useCase = makeUc(repo);

    await useCase.execute({ sessionUserId: userId,
      userId,
      displayName: 'נווה',
      cityId: '4000',
      cityName: 'חיפה',
      dateOfBirth: DOB,
      profileStreet: 'הרצל',
      profileStreetNumber: '12א',
    });

    expect(repo.rows.get(userId)?.profileStreetNumber).toBe('12א');
  });

  it('rejects profile street number with punctuation (FR-PROFILE-007)', async () => {
    const useCase = makeUc(seed());

    await expect(
      useCase.execute({ sessionUserId: userId,
        userId,
        displayName: 'נווה',
        cityId: '4000',
        cityName: 'חיפה',
        dateOfBirth: DOB,
        profileStreet: 'הרצל',
        profileStreetNumber: '12/3',
      }),
    ).rejects.toThrow('invalid_profile_street_number');
  });

  it('throws OnboardingError when invoked on a completed user (audit §17.3)', async () => {
    const repo = makeFakeUserRepo({
      [userId]: {
        displayName: 'placeholder',
        city: '5000',
        cityName: 'תל אביב - יפו',
        onboardingState: 'completed',
      },
    });
    const useCase = makeUc(repo);

    await expect(
      useCase.execute({ sessionUserId: userId, userId, displayName: 'נווה', cityId: '4000', cityName: 'חיפה' , dateOfBirth: DOB}),
    ).rejects.toMatchObject({
      name: 'OnboardingError',
      code: 'illegal_transition',
    } satisfies Partial<OnboardingError>);
  });

  it('is idempotent — accepts a pending_avatar user re-running step 1', async () => {
    const repo = makeFakeUserRepo({
      [userId]: {
        displayName: 'placeholder',
        city: '5000',
        cityName: 'תל אביב - יפו',
        onboardingState: 'pending_avatar',
      },
    });
    const useCase = makeUc(repo);

    await useCase.execute({ sessionUserId: userId, userId, displayName: 'נווה', cityId: '4000', cityName: 'חיפה' , dateOfBirth: DOB});

    expect(repo.rows.get(userId)?.onboardingState).toBe('pending_avatar');
  });

  describe('date of birth (FR-AUTH-010 AC2.d)', () => {
    it('stores the date of birth with the basic info', async () => {
      const repo = seed();
      await makeUc(repo).execute({ sessionUserId: userId, userId, displayName: 'נווה', cityId: '4000', cityName: 'חיפה', dateOfBirth: DOB });
      expect(repo.rows.get(userId)?.dateOfBirth).toBe(DOB);
    });

    it('rejects an underage member and saves nothing', async () => {
      const repo = seed();
      await expect(
        makeUc(repo).execute({ sessionUserId: userId, userId, displayName: 'נווה', cityId: '4000', cityName: 'חיפה', dateOfBirth: '2012-01-01' }),
      ).rejects.toMatchObject({ code: 'underage' });
      expect(repo.rows.get(userId)?.displayName).toBe('placeholder');
      expect(repo.rows.get(userId)?.dateOfBirth).toBeUndefined();
    });

    it('rejects a missing or impossible date', async () => {
      const repo = seed();
      for (const bad of ['', '2001-02-29']) {
        await expect(
          makeUc(repo).execute({ sessionUserId: userId, userId, displayName: 'נווה', cityId: '4000', cityName: 'חיפה', dateOfBirth: bad }),
        ).rejects.toMatchObject({ code: 'invalid_date_of_birth' });
      }
    });
  });
});
