import { describe, expect, it, vi } from 'vitest';
import type { IUserActivityRepository } from '../../ports/IUserActivityRepository';
import { RecordActiveDayUseCase } from '../RecordActiveDayUseCase';

describe('RecordActiveDayUseCase', () => {
  it('records the active day through the repository', async () => {
    const repo: IUserActivityRepository = { recordActiveDay: vi.fn(async () => undefined) };
    await new RecordActiveDayUseCase(repo).execute();
    expect(repo.recordActiveDay).toHaveBeenCalledTimes(1);
  });

  it('propagates a repository failure to the caller', async () => {
    const failure = new Error('network');
    const repo: IUserActivityRepository = { recordActiveDay: vi.fn(async () => Promise.reject(failure)) };
    await expect(new RecordActiveDayUseCase(repo).execute()).rejects.toBe(failure);
  });
});
