// FR-RIDE-046 — recurring ride use cases: the schedule is checked before the round trip,
// everything else is delegated to the server.
import { describe, expect, it, vi } from 'vitest';
import { RideError, type CreateRideSeriesInput } from '@kc/domain';
import type { IRideSeriesRepository } from '../../ports/IRideSeriesRepository';
import {
  CreateRideSeriesUseCase,
  ListMyRideSeriesUseCase,
  SetRideSeriesStatusUseCase,
  UpdateRideSeriesScheduleUseCase,
} from '../rideSeriesUseCases';

const NOW = new Date(2026, 10, 2, 9, 0);
const INPUT: CreateRideSeriesInput = {
  kindId: 'k1',
  direction: 'give',
  title: 'TLV → JLM',
  summary: null,
  details: { origin_place_id: '5000', dest_place_id: '3000', seats_available: 3 },
  schedule: { weekdays: [0, 1, 2, 3, 4], time: '07:30', endsOn: null },
  durationMinutes: 75,
};

function makeRepo() {
  return {
    listMine: vi.fn<IRideSeriesRepository['listMine']>(async () => []),
    create: vi.fn<IRideSeriesRepository['create']>(async () => ({ seriesId: 's1', firstListingId: 'l1' })),
    setStatus: vi.fn<IRideSeriesRepository['setStatus']>(async () => undefined),
    updateSchedule: vi.fn<IRideSeriesRepository['updateSchedule']>(async () => undefined),
  } satisfies IRideSeriesRepository;
}

describe('recurring ride use cases', () => {
  it('publishes a series and hands back its first occurrence', async () => {
    const repo = makeRepo();
    await expect(new CreateRideSeriesUseCase(repo).execute(INPUT, NOW)).resolves.toEqual({ seriesId: 's1', firstListingId: 'l1' });
    expect(repo.create).toHaveBeenCalledWith(INPUT);
  });

  it('refuses a schedule without weekdays or with an end date in the past, without calling the server', async () => {
    const repo = makeRepo();
    const noDays = { ...INPUT, schedule: { ...INPUT.schedule, weekdays: [] } };
    await expect(new CreateRideSeriesUseCase(repo).execute(noDays, NOW)).rejects.toMatchObject({ code: 'series_weekdays_required' });
    const ended = { ...INPUT, schedule: { ...INPUT.schedule, endsOn: '2026-11-01' } };
    await expect(new CreateRideSeriesUseCase(repo).execute(ended, NOW)).rejects.toBeInstanceOf(RideError);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('checks a new schedule the same way before rescheduling', async () => {
    const repo = makeRepo();
    const uc = new UpdateRideSeriesScheduleUseCase(repo);
    await uc.execute('s1', { weekdays: [2], time: '18:00', endsOn: '2026-11-02' }, null, NOW);
    expect(repo.updateSchedule).toHaveBeenCalledWith('s1', { weekdays: [2], time: '18:00', endsOn: '2026-11-02' }, null);
    await expect(uc.execute('s1', { weekdays: [2], time: '18h', endsOn: null }, null, NOW)).rejects.toMatchObject({ code: 'series_time_invalid' });
    expect(repo.updateSchedule).toHaveBeenCalledOnce();
  });

  it('lists mine and changes the status', async () => {
    const repo = makeRepo();
    await new ListMyRideSeriesUseCase(repo).execute();
    await new SetRideSeriesStatusUseCase(repo).execute('s1', 'paused');
    expect(repo.listMine).toHaveBeenCalledOnce();
    expect(repo.setStatus).toHaveBeenCalledWith('s1', 'paused');
  });
});
