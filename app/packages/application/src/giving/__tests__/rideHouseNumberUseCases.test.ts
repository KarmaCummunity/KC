import { describe, expect, it, vi } from 'vitest';
import { RideError } from '@kc/domain';
import type { IRideHouseNumberRepository } from '../../ports/IRideHouseNumberRepository';
import { GetRideHouseNumbersUseCase, SaveRideHouseNumbersUseCase } from '../rideHouseNumberUseCases';

function fakeRepo(): IRideHouseNumberRepository & { save: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> } {
  return { save: vi.fn().mockResolvedValue(undefined), get: vi.fn().mockResolvedValue({ dest: '7' }) };
}

describe('SaveRideHouseNumbersUseCase', () => {
  it('delegates valid numbers', async () => {
    const repo = fakeRepo();
    await new SaveRideHouseNumbersUseCase(repo).execute('L1', { origin: '12', dest: '' });
    expect(repo.save).toHaveBeenCalledWith('L1', { origin: '12', dest: '' });
  });

  it('refuses an invalid number before the round trip', async () => {
    const repo = fakeRepo();
    await expect(new SaveRideHouseNumbersUseCase(repo).execute('L1', { origin: 'abc' })).rejects.toBeInstanceOf(RideError);
    expect(repo.save).not.toHaveBeenCalled();
  });
});

describe('GetRideHouseNumbersUseCase', () => {
  it('returns what the repository allows the caller to see', async () => {
    await expect(new GetRideHouseNumbersUseCase(fakeRepo()).execute('L1')).resolves.toEqual({ dest: '7' });
  });
});
