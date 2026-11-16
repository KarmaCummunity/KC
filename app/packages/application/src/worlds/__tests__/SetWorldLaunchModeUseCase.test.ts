import { describe, expect, it } from 'vitest';
import { ValidationError } from '@kc/domain';
import type { IAppFlagsAdminRepository } from '../../ports/IAppFlagsAdminRepository';
import { SetWorldLaunchModeUseCase } from '../SetWorldLaunchModeUseCase';

/** Records every write; `refuse` makes the next write fail as the server would for a non-super-admin. */
function fakeFlags(refuse = false) {
  const writes: Array<[string, boolean]> = [];
  const repo: IAppFlagsAdminRepository = {
    async setFlag(key, enabled) {
      if (refuse) throw new Error('forbidden');
      writes.push([key, enabled]);
    },
  };
  return { repo, writes };
}

describe('SetWorldLaunchModeUseCase (#2277)', () => {
  it('turns a world active by switching its flag on, and back to a portal by switching it off', async () => {
    const { repo, writes } = fakeFlags();
    const useCase = new SetWorldLaunchModeUseCase(repo);
    await useCase.execute({ flagKey: 'world_animals_enabled', mode: 'active' });
    await useCase.execute({ flagKey: 'world_animals_enabled', mode: 'portal' });
    expect(writes).toEqual([['world_animals_enabled', true], ['world_animals_enabled', false]]);
  });

  it('refuses a key that is not a giving world flag, without calling the server', async () => {
    const { repo, writes } = fakeFlags();
    const useCase = new SetWorldLaunchModeUseCase(repo);
    for (const flagKey of ['pro_paywall', 'world_creative_enabled', '']) {
      await expect(useCase.execute({ flagKey, mode: 'active' })).rejects.toBeInstanceOf(ValidationError);
    }
    expect(writes).toEqual([]);
  });

  it('passes the server refusal on, so the screen can say the switch failed', async () => {
    const useCase = new SetWorldLaunchModeUseCase(fakeFlags(true).repo);
    await expect(useCase.execute({ flagKey: 'world_housing_enabled', mode: 'active' })).rejects.toThrow('forbidden');
  });
});
