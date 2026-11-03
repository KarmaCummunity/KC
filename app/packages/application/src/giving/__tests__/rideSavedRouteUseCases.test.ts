import { describe, expect, it, vi } from 'vitest';
import { RideError, type RidePlace, type SaveRideRouteInput } from '@kc/domain';
import type { IRideSavedRoutesRepository } from '../../ports/IRideSavedRoutesRepository';
import { ListMyRideRoutesUseCase, RemoveRideRouteUseCase, SaveRideRouteUseCase } from '../rideSavedRouteUseCases';

const TLV: RidePlace = { kind: 'city', id: '5000', label: 'Tel Aviv', lat: 32.08, lng: 34.78, cityId: '5000' };
const JLM: RidePlace = { kind: 'city', id: '3000', label: 'Jerusalem', lat: 31.77, lng: 35.21, cityId: '3000' };
const INPUT: SaveRideRouteInput = { wants: 'offers', origin: TLV, dest: JLM, weekdays: null, timeWindow: null };

function makeRepo() {
  return {
    listMine: vi.fn<IRideSavedRoutesRepository['listMine']>(async () => []),
    save: vi.fn<IRideSavedRoutesRepository['save']>(async () => undefined),
    remove: vi.fn<IRideSavedRoutesRepository['remove']>(async () => undefined),
  } satisfies IRideSavedRoutesRepository;
}

describe('saved route use cases', () => {
  it('saves a route', async () => {
    const repo = makeRepo();
    await new SaveRideRouteUseCase(repo).execute(INPUT);
    expect(repo.save).toHaveBeenCalledWith(INPUT);
  });

  it('refuses a route from a place to itself without calling the server', async () => {
    const repo = makeRepo();
    await expect(new SaveRideRouteUseCase(repo).execute({ ...INPUT, dest: TLV })).rejects.toBeInstanceOf(RideError);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('lists and removes routes', async () => {
    const repo = makeRepo();
    await new ListMyRideRoutesUseCase(repo).execute();
    await new RemoveRideRouteUseCase(repo).execute('r1');
    expect(repo.listMine).toHaveBeenCalledOnce();
    expect(repo.remove).toHaveBeenCalledWith('r1');
  });
});
