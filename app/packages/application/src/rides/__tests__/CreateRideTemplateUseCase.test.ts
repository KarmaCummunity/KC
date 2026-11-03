import { describe, expect, it } from 'vitest';
import type { ICityRepository } from '../../ports/ICityRepository';
import { CreateRideTemplateUseCase } from '../CreateRideTemplateUseCase';
import { FakeRideTemplateRepository } from './fakeRideTemplateRepository';

const fakeCities: ICityRepository = {
  async listAll() {
    return [
      { cityId: '5000', nameHe: 'תל אביב', nameEn: 'Tel Aviv' },
      { cityId: '4000', nameHe: 'חיפה', nameEn: 'Haifa' },
    ];
  },
};

function base() {
  return {
    ownerId: 'u_owner',
    mode: 'offer' as const,
    originCityId: '5000',
    destCityId: '4000',
    originStreet: 'דיזנגוף',
    originStreetNumber: null,
    destStreet: 'הנביאים',
    destStreetNumber: null,
    departTime: '07:30',
    weekdayMask: 42, // Mon+Wed+Fri
    seatsAvailable: 3,
    description: null,
    lookaheadDays: 7,
  };
}

describe('CreateRideTemplateUseCase', () => {
  it('creates an active template with the given pattern', async () => {
    const repo = new FakeRideTemplateRepository();
    const uc = new CreateRideTemplateUseCase(repo, fakeCities);

    const row = await uc.execute(base());

    expect(row.status).toBe('active');
    expect(row.weekdayMask).toBe(42);
    expect(row.visibility).toBe('Public');
    expect(row.lookaheadDays).toBe(7);
  });

  it('defaults visibility to Public when omitted', async () => {
    const repo = new FakeRideTemplateRepository();
    const uc = new CreateRideTemplateUseCase(repo, fakeCities);

    const row = await uc.execute(base());
    expect(row.visibility).toBe('Public');
  });

  it('honors an explicit FollowersOnly visibility', async () => {
    const repo = new FakeRideTemplateRepository();
    const uc = new CreateRideTemplateUseCase(repo, fakeCities);

    const row = await uc.execute({ ...base(), visibility: 'FollowersOnly' });
    expect(row.visibility).toBe('FollowersOnly');
  });

  it('throws same_route when origin === dest with same street', async () => {
    const repo = new FakeRideTemplateRepository();
    const uc = new CreateRideTemplateUseCase(repo, fakeCities);

    await expect(
      uc.execute({
        ...base(),
        destCityId: '5000',
        originStreet: 'דיזנגוף',
        destStreet: 'דיזנגוף',
      }),
    ).rejects.toMatchObject({ code: 'same_route' });
  });

  it('throws seats_forbidden when mode is request but seats provided', async () => {
    const repo = new FakeRideTemplateRepository();
    const uc = new CreateRideTemplateUseCase(repo, fakeCities);

    await expect(
      uc.execute({ ...base(), mode: 'request', seatsAvailable: 1 }),
    ).rejects.toMatchObject({ code: 'seats_forbidden' });
  });

  it('throws seats_required when mode is offer but seats null', async () => {
    const repo = new FakeRideTemplateRepository();
    const uc = new CreateRideTemplateUseCase(repo, fakeCities);

    await expect(
      uc.execute({ ...base(), mode: 'offer', seatsAvailable: null }),
    ).rejects.toMatchObject({ code: 'seats_required' });
  });

  it('throws invalid_weekday_mask on out-of-range mask', async () => {
    const repo = new FakeRideTemplateRepository();
    const uc = new CreateRideTemplateUseCase(repo, fakeCities);

    await expect(uc.execute({ ...base(), weekdayMask: 0 })).rejects.toMatchObject({
      code: 'invalid_weekday_mask',
    });
    await expect(uc.execute({ ...base(), weekdayMask: 200 })).rejects.toMatchObject({
      code: 'invalid_weekday_mask',
    });
  });

  it('throws invalid_lookahead_days outside [1, 30]', async () => {
    const repo = new FakeRideTemplateRepository();
    const uc = new CreateRideTemplateUseCase(repo, fakeCities);

    await expect(uc.execute({ ...base(), lookaheadDays: 0 })).rejects.toMatchObject({
      code: 'invalid_lookahead_days',
    });
    await expect(uc.execute({ ...base(), lookaheadDays: 31 })).rejects.toMatchObject({
      code: 'invalid_lookahead_days',
    });
  });

  it('throws city_not_found when the city catalog rejects either id', async () => {
    const repo = new FakeRideTemplateRepository();
    const uc = new CreateRideTemplateUseCase(repo, fakeCities);

    await expect(
      uc.execute({ ...base(), originCityId: 'X' }),
    ).rejects.toMatchObject({ code: 'city_not_found' });

    await expect(
      uc.execute({ ...base(), destCityId: 'Y' }),
    ).rejects.toMatchObject({ code: 'city_not_found' });
  });
});
