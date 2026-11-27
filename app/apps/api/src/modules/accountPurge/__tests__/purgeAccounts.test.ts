import { describe, expect, it } from 'vitest';
import { memberFolders, type PurgeDeps, purgeDueAccounts } from '../purgeAccounts';

interface Setup {
  readonly due: string[];
  readonly buckets?: string[];
  /** Accounts whose photo jobs still hold a lease. */
  readonly held?: string[];
  /** Makes one step fail for one account: `<step>:<userId>`. */
  readonly failing?: string[];
  readonly dueFails?: boolean;
}

/** Ports that record every step in order, as `<step>:<userId>` or `files:<userId>:<bucket>/<folder>`. */
function setup({ due, buckets = ['avatars', 'post-images'], held = [], failing = [], dueFails = false }: Setup) {
  const steps: string[] = [];
  const reported: Array<{ stage: string; user_id: string }> = [];
  /** Records a step, and fails it when the test asked for that. */
  const step = (name: string, userId: string, detail = '') => {
    if (failing.includes(`${name}:${userId}`)) return Promise.reject(new Error(`${name} failed`));
    steps.push(`${name}:${userId}${detail}`);
    return Promise.resolve();
  };
  const deps: PurgeDeps = {
    db: {
      dueAccounts: () => (dueFails ? Promise.reject(new Error('database unavailable')) : Promise.resolve(due)),
      prepare: (userId) => step('prepare', userId),
      holdForMedia: (userId) => Promise.resolve(held.includes(userId)),
      finish: async (userId) => {
        await step('finish', userId);
        return true;
      },
    },
    files: {
      buckets: () => Promise.resolve(buckets),
      removeFolder: (bucket, folder) => step('files', folder.split('/').at(-1) as string, `:${bucket}/${folder}`),
    },
    report: (_error, tags) => reported.push(tags),
  };
  return { run: (batchSize = 50) => purgeDueAccounts(deps, batchSize), steps, reported };
}

describe('purgeDueAccounts', () => {
  it('purges each due account in order: tombstone and billing first, then its files, then the identity', async () => {
    const { run, steps } = setup({ due: ['u1'], buckets: ['avatars'] });

    expect(await run()).toEqual({ purged: 1, failed: 0, deferred: 0 });
    expect(steps).toEqual(['prepare:u1', 'files:u1:avatars/u1', 'finish:u1']);
  });

  it('empties the server-made photo copies under derived/<user_id>/ together with the member\'s own folder, before the identity', async () => {
    const { run, steps } = setup({ due: ['u1'] });

    await run();

    expect(steps).toEqual(['prepare:u1', 'files:u1:avatars/u1', 'files:u1:post-images/u1', 'files:u1:post-images/derived/u1', 'finish:u1']);
    expect(memberFolders('post-images', 'u1')).toEqual(['u1', 'derived/u1']);
    expect(memberFolders('chat-media', 'u1')).toEqual(['u1']);
  });

  it('reports a failing account, keeps its identity, and does not let it block the others', async () => {
    const { run, steps, reported } = setup({ due: ['u1', 'u2'], buckets: ['avatars'], failing: ['files:u1'] });

    expect(await run()).toEqual({ purged: 1, failed: 1, deferred: 0 });
    // The identity of the failed account is not deleted: it stays due and the next run retries it.
    expect(steps).toEqual(['prepare:u1', 'prepare:u2', 'files:u2:avatars/u2', 'finish:u2']);
    expect(reported).toEqual([{ stage: 'files', user_id: 'u1' }]);
  });

  it.each(['prepare', 'finish'] as const)('names the stage when %s fails', async (stage) => {
    const { run, reported } = setup({ due: ['u1'], buckets: ['avatars'], failing: [`${stage}:u1`] });

    expect(await run()).toEqual({ purged: 0, failed: 1, deferred: 0 });
    expect(reported).toEqual([{ stage, user_id: 'u1' }]);
  });

  it('defers an account whose photo job still holds a lease: no file is touched and the identity stays', async () => {
    const { run, steps, reported } = setup({ due: ['u1', 'u2'], buckets: ['avatars'], held: ['u1'] });

    expect(await run()).toEqual({ purged: 1, failed: 0, deferred: 1 });
    expect(steps).toEqual(['prepare:u1', 'prepare:u2', 'files:u2:avatars/u2', 'finish:u2']);
    // Deferred is not a failure: nothing is reported.
    expect(reported).toEqual([]);
  });

  it('fails the whole run when the due accounts cannot be read: nothing was purged', async () => {
    const { run, steps } = setup({ due: ['u1'], dueFails: true });

    await expect(run()).rejects.toThrow('database unavailable');
    expect(steps).toEqual([]);
  });

  it('does not read the buckets when no account is due', async () => {
    const { run, steps } = setup({ due: [] });

    expect(await run()).toEqual({ purged: 0, failed: 0, deferred: 0 });
    expect(steps).toEqual([]);
  });
});
