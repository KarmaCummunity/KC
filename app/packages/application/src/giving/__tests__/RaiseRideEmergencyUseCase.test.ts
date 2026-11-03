import { describe, expect, it, vi } from 'vitest';
import type { IRideSafetyRepository } from '../../ports/IRideSafetyRepository';
import { RaiseRideEmergencyUseCase } from '../RaiseRideEmergencyUseCase';

function makeRepo() {
  return { raiseEmergency: vi.fn<IRideSafetyRepository['raiseEmergency']>(async () => undefined) } satisfies IRideSafetyRepository;
}

describe('RaiseRideEmergencyUseCase', () => {
  it('sends the trimmed note, or none when blank', async () => {
    const repo = makeRepo();
    await new RaiseRideEmergencyUseCase(repo).execute('l1', '  flat tyre ');
    await new RaiseRideEmergencyUseCase(repo).execute('l1', '   ');
    expect(repo.raiseEmergency).toHaveBeenNthCalledWith(1, 'l1', 'flat tyre');
    expect(repo.raiseEmergency).toHaveBeenNthCalledWith(2, 'l1', null);
  });

  it('cuts an over-long note to 500 characters', async () => {
    const repo = makeRepo();
    await new RaiseRideEmergencyUseCase(repo).execute('l1', 'x'.repeat(600));
    expect(repo.raiseEmergency.mock.calls[0]?.[1]).toHaveLength(500);
  });

  it('surfaces a refusal from the server', async () => {
    const repo = makeRepo();
    repo.raiseEmergency.mockRejectedValueOnce(new Error('ride_not_active'));
    await expect(new RaiseRideEmergencyUseCase(repo).execute('l1')).rejects.toThrow('ride_not_active');
  });
});
