// _shared/accountPurge.test.ts — run: deno test supabase/functions/_shared
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { type AccountPurgeGateway, POST_MEDIA_BUCKET, purgeAccount, type PurgeStage } from './accountPurge.ts';

type Failing = 'mediaPaths' | 'remove' | 'list' | 'deleteData' | 'deleteIdentity';

/** A gateway that records every call and rejects at the named step. */
function fakeGateway(failAt?: Failing) {
  const calls: string[] = [];
  const step = (name: Failing, label: string) => {
    calls.push(label);
    return name === failAt ? Promise.reject(new Error(name)) : Promise.resolve();
  };
  const gateway: AccountPurgeGateway = {
    mediaPaths: (u) => step('mediaPaths', `paths:${u}`).then(() => ['u1/post/a.jpg']),
    storage: {
      list: (bucket, prefix) => step('list', `list:${bucket}:${prefix}`).then(() => []),
      remove: (bucket, paths) => step('remove', `remove:${bucket}:${paths.join(',')}`),
    },
    deleteData: (u) => step('deleteData', `data:${u}`),
    deleteIdentity: (u) => step('deleteIdentity', `identity:${u}`),
  };
  return { gateway, calls };
}

/** Collects the reported stages. */
function recorder() {
  const stages: PurgeStage[] = [];
  return { stages, report: (_e: unknown, stage: PurgeStage) => Promise.resolve(void stages.push(stage)) };
}

Deno.test('purges Storage, then the data, then the identity', async () => {
  const { gateway, calls } = fakeGateway();
  const { stages, report } = recorder();

  assertEquals(await purgeAccount(gateway, 'u1', report), true);
  assertEquals(calls[0], 'paths:u1');
  assertEquals(calls[1], `remove:${POST_MEDIA_BUCKET}:u1/post/a.jpg`);
  assertEquals(calls.slice(-2), ['data:u1', 'identity:u1']);
  assertEquals(stages, []);
});

Deno.test('a Storage failure stops before any data is deleted, so the next run retries it', async () => {
  for (const failAt of ['remove', 'list'] as const) {
    const { gateway, calls } = fakeGateway(failAt);
    const { stages, report } = recorder();

    assertEquals(await purgeAccount(gateway, 'u1', report), false);
    assertEquals(calls.includes('data:u1'), false);
    assertEquals(calls.includes('identity:u1'), false);
    assertEquals(stages.every((s) => s === 'storage_cleanup'), true);
  }
});

Deno.test('a failing step is reported and the later steps do not run', async () => {
  const cases: [Failing, PurgeStage, string | null][] = [
    ['mediaPaths', 'media_paths', 'data:u1'],
    ['deleteData', 'db_purge', 'identity:u1'],
    ['deleteIdentity', 'auth_delete', null],
  ];
  for (const [failAt, stage, skipped] of cases) {
    const { gateway, calls } = fakeGateway(failAt);
    const { stages, report } = recorder();

    assertEquals(await purgeAccount(gateway, 'u1', report), false);
    assertEquals(stages, [stage]);
    if (skipped) assertEquals(calls.includes(skipped), false);
  }
});
