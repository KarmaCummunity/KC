import { describe, expect, it } from 'vitest';
import { RideError } from '@kc/domain';
import type { ICityRepository } from '../../ports/ICityRepository';
import { CreateRideListingUseCase } from '../CreateRideListingUseCase';
import { FakeRideListingRepository } from './fakeRideListingRepository';

const fakeCities: ICityRepository = {
  async listAll() {
    return [
      { cityId: '5000', nameHe: 'תל אביב', nameEn: 'Tel Aviv' },
      { cityId: '4000', nameHe: 'חיפה', nameEn: 'Haifa' },
    ];
  },
};

describe('CreateRideListingUseCase', () => {
  it('creates a listing with generated title', async () => {
    const repo = new FakeRideListingRepository();
    const uc = new CreateRideListingUseCase(repo, fakeCities);
    const departsAt = new Date(Date.now() + 3600_000).toISOString();

    const row = await uc.execute({
      ownerId: 'u_1',
      mode: 'offer',
      originCityId: '5000',
      destCityId: '4000',
      originStreet: 'דיזנגוף',
      originStreetNumber: null,
      destStreet: 'הנביאים',
      destStreetNumber: null,
      departsAt,
      seatsAvailable: 3,
      description: null,
    });

    expect(row.rideId).toBe('ride-1');
    expect(repo.lastCreateArgs?.visibility).toBe('Public');
    expect(repo.lastCreateArgs?.title).toContain('תל אביב');
    expect(repo.lastCreateArgs?.title).toContain('חיפה');
  });

  it('defaults visibility to Public when caller omits it', async () => {
    const repo = new FakeRideListingRepository();
    const uc = new CreateRideListingUseCase(repo, fakeCities);

    await uc.execute({
      ownerId: 'u_1',
      mode: 'offer',
      originCityId: '5000',
      destCityId: '4000',
      originStreet: 'דיזנגוף',
      originStreetNumber: null,
      destStreet: 'הנביאים',
      destStreetNumber: null,
      departsAt: new Date(Date.now() + 3600_000).toISOString(),
      seatsAvailable: 3,
      description: null,
    });

    expect(repo.lastCreateArgs?.visibility).toBe('Public');
  });

  it('honors an explicit visibility input (FollowersOnly / OnlyMe)', async () => {
    const repo = new FakeRideListingRepository();
    const uc = new CreateRideListingUseCase(repo, fakeCities);

    await uc.execute({
      ownerId: 'u_1',
      mode: 'offer',
      originCityId: '5000',
      destCityId: '4000',
      originStreet: 'דיזנגוף',
      originStreetNumber: null,
      destStreet: 'הנביאים',
      destStreetNumber: null,
      departsAt: new Date(Date.now() + 3600_000).toISOString(),
      seatsAvailable: 3,
      description: null,
      visibility: 'FollowersOnly',
    });

    expect(repo.lastCreateArgs?.visibility).toBe('FollowersOnly');

    await uc.execute({
      ownerId: 'u_2',
      mode: 'request',
      originCityId: '5000',
      destCityId: '4000',
      originStreet: 'דיזנגוף',
      originStreetNumber: null,
      destStreet: 'הנביאים',
      destStreetNumber: null,
      departsAt: new Date(Date.now() + 3600_000).toISOString(),
      seatsAvailable: null,
      description: null,
      visibility: 'OnlyMe',
    });

    expect(repo.lastCreateArgs?.visibility).toBe('OnlyMe');
  });

  it('propagates RideError from validateRideDraft', async () => {
    const repo = new FakeRideListingRepository();
    const uc = new CreateRideListingUseCase(repo, fakeCities);

    await expect(
      uc.execute({
        ownerId: 'u_1',
        mode: 'offer',
        originCityId: '5000',
        destCityId: '5000',
        originStreet: 'א',
        originStreetNumber: null,
        destStreet: 'א',
        destStreetNumber: null,
        departsAt: new Date().toISOString(),
        seatsAvailable: 3,
        description: null,
      }),
    ).rejects.toBeInstanceOf(RideError);
  });

  it('rejects description longer than 500 characters', async () => {
    const repo = new FakeRideListingRepository();
    const uc = new CreateRideListingUseCase(repo, fakeCities);

    await expect(
      uc.execute({
        ownerId: 'u_1',
        mode: 'offer',
        originCityId: '5000',
        destCityId: '4000',
        originStreet: 'Street A',
        originStreetNumber: null,
        destStreet: 'Street B',
        destStreetNumber: null,
        departsAt: new Date().toISOString(),
        seatsAvailable: 3,
        description: 'a'.repeat(501),
      }),
    ).rejects.toMatchObject({ code: 'description_too_long' });
  });

  it('rejects linkedPostId on offer mode (seats_forbidden)', async () => {
    const repo = new FakeRideListingRepository();
    const uc = new CreateRideListingUseCase(repo, fakeCities);

    await expect(
      uc.execute({
        ownerId: 'u_1',
        mode: 'offer',
        originCityId: '5000',
        destCityId: '4000',
        originStreet: 'Street A',
        originStreetNumber: null,
        destStreet: 'Street B',
        destStreetNumber: null,
        departsAt: new Date().toISOString(),
        seatsAvailable: 3,
        description: null,
        linkedPostId: 'post_123',
      }),
    ).rejects.toMatchObject({ code: 'seats_forbidden' });
  });

  it('throws city_not_found if origin or dest city does not exist in catalog', async () => {
    const repo = new FakeRideListingRepository();
    const uc = new CreateRideListingUseCase(repo, fakeCities);

    await expect(
      uc.execute({
        ownerId: 'u_1',
        mode: 'offer',
        originCityId: 'unknown_city',
        destCityId: '4000',
        originStreet: 'Street A',
        originStreetNumber: null,
        destStreet: 'Street B',
        destStreetNumber: null,
        departsAt: new Date().toISOString(),
        seatsAvailable: 3,
        description: null,
      }),
    ).rejects.toMatchObject({ code: 'city_not_found' });

    await expect(
      uc.execute({
        ownerId: 'u_1',
        mode: 'offer',
        originCityId: '5000',
        destCityId: 'unknown_city',
        originStreet: 'Street A',
        originStreetNumber: null,
        destStreet: 'Street B',
        destStreetNumber: null,
        departsAt: new Date().toISOString(),
        seatsAvailable: 3,
        description: null,
      }),
    ).rejects.toMatchObject({ code: 'city_not_found' });
  });

  it('correctly maps advanced fields and linkedPostId to repository input', async () => {
    const repo = new FakeRideListingRepository();
    const uc = new CreateRideListingUseCase(repo, fakeCities);
    const departsAt = new Date(Date.now() + 3600_000).toISOString();

    await uc.execute({
      ownerId: 'u_1',
      mode: 'request',
      originCityId: '5000',
      destCityId: '4000',
      originStreet: 'Street A',
      originStreetNumber: '1',
      destStreet: 'Street B',
      destStreetNumber: '2',
      departsAt,
      seatsAvailable: null,
      description: 'Ride request',
      linkedPostId: 'post_abc',
      cargo: {
        enabled: true,
        maxVolumeL: 100,
        maxWeightKg: 20,
        allowedTypes: ['small_packages'],
      },
      payment: {
        model: 'expense_share',
        amountIls: 30,
      },
      requirements: {
        gender: 'women_only',
        smokingAllowed: false,
        petsAllowed: true,
        verifiedOnly: true,
      },
    });

    expect(repo.lastCreateArgs?.cargoEnabled).toBe(true);
    expect(repo.lastCreateArgs?.cargoMaxVolumeL).toBe(100);
    expect(repo.lastCreateArgs?.cargoMaxWeightKg).toBe(20);
    expect(repo.lastCreateArgs?.cargoAllowedTypes).toEqual(['small_packages']);
    expect(repo.lastCreateArgs?.paymentModel).toBe('expense_share');
    expect(repo.lastCreateArgs?.paymentAmountIls).toBe(30);
    expect(repo.lastCreateArgs?.reqGender).toBe('women_only');
    expect(repo.lastCreateArgs?.reqPetsAllowed).toBe(true);
    expect(repo.lastCreateArgs?.linkedPostId).toBe('post_abc');
  });
});
