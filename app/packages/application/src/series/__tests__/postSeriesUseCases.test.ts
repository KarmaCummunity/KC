import { describe, expect, it, vi } from 'vitest';
import type { CreatePostSeriesInput, PostSeriesSchedule } from '@kc/domain';
import type { IPostSeriesRepository } from '../../ports/IPostSeriesRepository';
import {
  CancelPostSeriesOccurrenceUseCase,
  CreatePostSeriesUseCase,
  SetPostSeriesStatusUseCase,
  UpdatePostSeriesUseCase,
} from '../postSeriesUseCases';

const NOW = new Date('2026-11-11T09:00:00');
const SCHEDULE: PostSeriesSchedule = { weekdays: [2], startTime: '17:00', durationMinutes: 120, endsOn: null };
const INPUT: CreatePostSeriesInput = {
  kindId: 'k1', title: 'Weekly garden day', summary: null, details: { capacity: 5 }, cityId: 'tel-aviv',
  schedule: SCHEDULE, timeZone: 'Asia/Jerusalem', orgId: null,
};

function fakeRepo(): IPostSeriesRepository {
  return {
    listMine: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ seriesId: 's1', firstPostId: 'p1' }),
    update: vi.fn().mockResolvedValue(undefined),
    setStatus: vi.fn().mockResolvedValue(undefined),
    cancelOccurrence: vi.fn().mockResolvedValue(undefined),
    listOccurrences: vi.fn().mockResolvedValue([]),
  };
}

describe('post series use cases', () => {
  it('publishes a valid series and hands back its first date', async () => {
    const repo = fakeRepo();
    await expect(new CreatePostSeriesUseCase(repo).execute(INPUT, NOW)).resolves.toEqual({ seriesId: 's1', firstPostId: 'p1' });
    expect(repo.create).toHaveBeenCalledWith(INPUT);
  });

  it('refuses a schedule with no weekday before calling the server', async () => {
    const repo = fakeRepo();
    const bad = { ...INPUT, schedule: { ...SCHEDULE, weekdays: [] } };
    await expect(new CreatePostSeriesUseCase(repo).execute(bad, NOW)).rejects.toMatchObject({ code: 'series_weekdays_required' });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('checks the schedule of an edit too', async () => {
    const repo = fakeRepo();
    const edit = { schedule: { ...SCHEDULE, endsOn: '2026-11-01' } };
    await expect(new UpdatePostSeriesUseCase(repo).execute('s1', edit, NOW)).rejects.toMatchObject({ code: 'series_ends_in_past' });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('delegates a status change and a single-date cancel', async () => {
    const repo = fakeRepo();
    await new SetPostSeriesStatusUseCase(repo).execute('s1', 'ended');
    await new CancelPostSeriesOccurrenceUseCase(repo).execute('p9');
    expect(repo.setStatus).toHaveBeenCalledWith('s1', 'ended');
    expect(repo.cancelOccurrence).toHaveBeenCalledWith('p9');
  });
});
