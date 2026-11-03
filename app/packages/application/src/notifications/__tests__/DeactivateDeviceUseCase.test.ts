import { describe, it, expect } from 'vitest';
import { DeactivateDeviceUseCase } from '../DeactivateDeviceUseCase';
import { RegisterDeviceUseCase } from '../RegisterDeviceUseCase';
import { FakeDeviceRepository } from './FakeDeviceRepository';

describe('DeactivateDeviceUseCase', () => {
  it('removes a registered token', async () => {
    const repo = new FakeDeviceRepository();
    await new RegisterDeviceUseCase(repo).execute({
      userId: 'u1', pushToken: 'T1', platform: 'ios',
    });

    await new DeactivateDeviceUseCase(repo).execute('T1');

    expect(repo.rows).toHaveLength(0);
  });

  it('is a no-op for an unknown token', async () => {
    const repo = new FakeDeviceRepository();
    await expect(new DeactivateDeviceUseCase(repo).execute('unknown')).resolves.toBeUndefined();
  });

  it('returns early when pushToken is empty', async () => {
    const repo = new FakeDeviceRepository();
    await expect(new DeactivateDeviceUseCase(repo).execute('')).resolves.toBeUndefined();
  });
});
