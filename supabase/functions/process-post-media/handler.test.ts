import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { createMediaHandler, type MediaDeps, type MediaJob, thumbnailPath } from './handler.ts';

const job: MediaJob = { id: 'media', storage_key: 'owner/photo.png', mime_type: 'image/png', attempts: 1 };
const request = (key = 'secret') => new Request('https://test', { method: 'POST', headers: { Authorization: `Bearer ${key}` } });
function fixture(overrides: Partial<MediaDeps> = {}) {
  const calls: string[] = [];
  const deps: MediaDeps = {
    serviceRoleKey: ['secret'],
    claim: () => { calls.push('claim'); return Promise.resolve([job]); },
    finish: (_job, ok) => { calls.push(`finish:${ok}`); return Promise.resolve(ok || _job.attempts >= 3); },
    download: () => { calls.push('download'); return Promise.resolve(new Uint8Array([1])); },
    encode: () => { calls.push('encode'); return Promise.resolve({ original: new Uint8Array([2]), thumb: new Uint8Array([3]) }); },
    upload: (path) => { calls.push(path); return Promise.resolve(); },
    report: () => Promise.resolve(),
    ...overrides,
  };
  return { handler: createMediaHandler(deps), calls };
}
Deno.test('rejects callers before claiming work', async () => {
  const { handler, calls } = fixture();
  assertEquals((await handler(request('anon'))).status, 401);
  assertEquals((await handler(new Request('https://test'))).status, 405);
  assertEquals(calls, []);
});
Deno.test('marks ready only after decode and both uploads, preserving PNG path', async () => {
  const { handler, calls } = fixture();
  const res = await handler(request());
  assertEquals((await res.json()).ready, 1);
  assertEquals(calls, ['claim', 'download', 'encode', 'owner/photo.png', 'owner/photo-thumb.png', 'finish:true']);
});
for (const stage of ['download', 'encode', 'upload'] as const) {
  Deno.test(`${stage} failure retries, never ready`, async () => {
    const broken = () => Promise.reject(new Error('broken'));
    const { handler, calls } = fixture({ [stage]: broken });
    assertEquals((await (await handler(request())).json()).retry, 1);
    assertEquals(calls.includes('finish:true'), false);
    assertEquals(calls.at(-1), 'finish:false');
  });
}
Deno.test('third processing failure is terminal and counted', async () => {
  const { handler } = fixture({ claim: () => Promise.resolve([{ ...job, attempts: 3 }]), encode: () => Promise.reject(new Error('invalid_image')) });
  assertEquals((await (await handler(request())).json()).failed, 1);
});
Deno.test('thumbnail upload failure leaves row pending', async () => {
  const { handler, calls } = fixture({ upload: (path) => path.includes('-thumb') ? Promise.reject(new Error('storage')) : Promise.resolve() });
  assertEquals((await (await handler(request())).json()).retry, 1);
  assertEquals(calls.includes('finish:true'), false);
});
Deno.test('unavailable DB fails the run, expired attempts do not count ready', async () => {
  const { handler } = fixture({ claim: () => Promise.reject(new Error('DB')) });
  assertEquals((await handler(request())).status, 500);
  const stale = fixture({ finish: () => Promise.resolve(false) });
  assertEquals((await (await stale.handler(request())).json()).ready, 0);
});
Deno.test('thumbnail path handles dotted folders and extensionless names', () => {
  assertEquals(thumbnailPath('a.b/photo'), 'a.b/photo-thumb');
  assertEquals(thumbnailPath('a/photo.jpg'), 'a/photo-thumb.jpg');
});
