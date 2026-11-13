import { describe, expect, it, vi } from 'vitest';
import { DemoDataError, type DemoDataSeedResult, type DemoDataStep, type DemoDataWipeResult } from '@kc/domain';
import { GetDemoDataStatusUseCase, RestoreDemoDataUseCase, WipeDemoDataUseCase } from '../DemoDataUseCases';
import type { IDemoDataRepository } from '../IDemoDataRepository';

const WIPED: DemoDataWipeResult = {
  usersDeleted: 200, postsDeleted: 720, chatsDeleted: 150, organizationsDeleted: 3, organizationsKept: 0,
};
const SEEDED: DemoDataSeedResult = {
  users: 200, itemPosts: 600, ridePosts: 120, follows: 1600, chats: 150, organizations: 3, orgMemberships: 12,
};

const step = <R>(progressKey: string, result: R | null = null): DemoDataStep<R> => ({
  done: result !== null, progressKey, result,
});

function makeRepo(overrides: Partial<IDemoDataRepository> = {}): IDemoDataRepository {
  return {
    getStatus: vi.fn(),
    wipeStep: vi.fn(),
    seedStep: vi.fn(),
    ...overrides,
  };
}

describe('Demo data use cases (FR-ADMIN-031)', () => {
  it('reads the status from the repository', async () => {
    const getStatus = vi.fn(async () => ({
      demoUsers: 1, demoOrganizations: 0, demoItemPosts: 0, demoRidePosts: 0, demoFollows: 0,
      demoChats: 0, demoOrgMemberships: 0, canSeed: true, hasSavedPassword: true,
    }));
    await expect(new GetDemoDataStatusUseCase(makeRepo({ getStatus })).execute()).resolves.toMatchObject({ demoUsers: 1 });
  });

  it('wipe calls the step until done and reports each phase', async () => {
    const wipeStep = vi.fn<IDemoDataRepository['wipeStep']>()
      .mockResolvedValueOnce(step('wipe_accounts'))
      .mockResolvedValueOnce(step('done', WIPED));
    const progress: string[] = [];
    const result = await new WipeDemoDataUseCase(makeRepo({ wipeStep })).execute((k) => progress.push(k));
    expect(result).toEqual(WIPED);
    expect(wipeStep).toHaveBeenCalledTimes(2);
    expect(progress).toEqual(['wipe_accounts', 'done']);
  });

  it('restore sends the password with the first step only', async () => {
    const seedStep = vi.fn<IDemoDataRepository['seedStep']>()
      .mockResolvedValueOnce(step('wipe_accounts'))
      .mockResolvedValueOnce(step('members'))
      .mockResolvedValueOnce(step('done', SEEDED));
    const result = await new RestoreDemoDataUseCase(makeRepo({ seedStep })).execute('SeedPass-2026');
    expect(result).toEqual(SEEDED);
    expect(seedStep.mock.calls).toEqual([['SeedPass-2026'], [undefined], [undefined]]);
  });

  it('restore refuses a short password before calling the server (AC9)', async () => {
    const seedStep = vi.fn<IDemoDataRepository['seedStep']>();
    await expect(new RestoreDemoDataUseCase(makeRepo({ seedStep })).execute('short')).rejects.toMatchObject({
      code: 'password_too_short',
    });
    expect(seedStep).not.toHaveBeenCalled();
  });

  it('a refusal of a step reaches the caller unchanged', async () => {
    const seedStep = vi.fn<IDemoDataRepository['seedStep']>().mockRejectedValue(new DemoDataError('not_dev_environment'));
    await expect(new RestoreDemoDataUseCase(makeRepo({ seedStep })).execute()).rejects.toMatchObject({
      code: 'not_dev_environment',
    });
  });

  it('an operation that never reports done stops with `incomplete`', async () => {
    const wipeStep = vi.fn<IDemoDataRepository['wipeStep']>().mockResolvedValue(step('wipe_content'));
    await expect(new WipeDemoDataUseCase(makeRepo({ wipeStep })).execute()).rejects.toMatchObject({ code: 'incomplete' });
    expect(wipeStep).toHaveBeenCalledTimes(16);
  });
});
