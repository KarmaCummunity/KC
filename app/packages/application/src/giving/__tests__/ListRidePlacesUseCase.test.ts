import { describe, expect, it, vi } from 'vitest';
import type { RidePlace } from '@kc/domain';
import type { IRidePlaceRepository } from '../../ports/IRidePlaceRepository';
import { ListRidePlacesUseCase } from '../ListRidePlacesUseCase';

const HADERA: RidePlace = { kind: 'city', id: '6500', label: 'חדרה', lat: 32.43, lng: 34.91, cityId: '6500' };

describe('ListRidePlacesUseCase', () => {
  it('returns the catalog from the repository', async () => {
    const repo = { listPlaces: vi.fn<IRidePlaceRepository['listPlaces']>(async () => [HADERA]) } satisfies IRidePlaceRepository;
    await expect(new ListRidePlacesUseCase(repo).execute()).resolves.toEqual([HADERA]);
    expect(repo.listPlaces).toHaveBeenCalledOnce();
  });

  it('surfaces a failed load', async () => {
    const repo = { listPlaces: vi.fn<IRidePlaceRepository['listPlaces']>(async () => { throw new Error('offline'); }) };
    await expect(new ListRidePlacesUseCase(repo).execute()).rejects.toThrow('offline');
  });
});
