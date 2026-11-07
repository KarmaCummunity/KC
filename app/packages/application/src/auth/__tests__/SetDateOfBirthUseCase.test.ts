import { describe, expect, it } from 'vitest';
import { SetDateOfBirthUseCase } from '../SetDateOfBirthUseCase';
import { ProfileError } from '../errors';
import { makeFakeUserRepo } from './onboardingFakeUserRepository';

// FR-AUTH-010 AC2.d — 18+ on the fixed clock 3 Nov 2026.
const NOW = () => new Date(2026, 10, 3);
const userId = 'user-1';
const seed = () =>
  makeFakeUserRepo({ [userId]: { displayName: 'x', city: '1', cityName: 'c', onboardingState: 'completed' } });

describe('SetDateOfBirthUseCase', () => {
  it('stores an adult date of birth', async () => {
    const repo = seed();
    await new SetDateOfBirthUseCase(repo, NOW).execute({ sessionUserId: userId, userId, dateOfBirth: '1990-05-15' });
    expect(repo.rows.get(userId)?.dateOfBirth).toBe('1990-05-15');
  });

  it('accepts exactly 18 today and rejects one day short, saving nothing', async () => {
    const repo = seed();
    const uc = new SetDateOfBirthUseCase(repo, NOW);
    await uc.execute({ sessionUserId: userId, userId, dateOfBirth: '2008-11-03' });
    expect(repo.rows.get(userId)?.dateOfBirth).toBe('2008-11-03');

    const fresh = seed();
    await expect(
      new SetDateOfBirthUseCase(fresh, NOW).execute({ sessionUserId: userId, userId, dateOfBirth: '2008-11-04' }),
    ).rejects.toMatchObject({ code: 'underage' });
    expect(fresh.rows.get(userId)?.dateOfBirth).toBeUndefined();
  });

  it.each(['', 'nonsense', '2001-02-29', '2027-01-01', '1899-12-31'])('rejects the invalid date "%s"', async (bad) => {
    const repo = seed();
    const run = new SetDateOfBirthUseCase(repo, NOW).execute({ sessionUserId: userId, userId, dateOfBirth: bad });
    await expect(run).rejects.toBeInstanceOf(ProfileError);
    await expect(run).rejects.toMatchObject({ code: 'invalid_date_of_birth' });
  });

  it('refuses to act for another user than the signed-in one', async () => {
    const repo = seed();
    await expect(
      new SetDateOfBirthUseCase(repo, NOW).execute({ sessionUserId: 'someone-else', userId, dateOfBirth: '1990-05-15' }),
    ).rejects.toThrow();
  });
});
