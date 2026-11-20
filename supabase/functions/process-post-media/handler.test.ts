// run: deno test --allow-read (from supabase/functions). Mocked I/O only.
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { Jimp } from 'https://esm.sh/jimp@1.6.0';
import { createProcessPostMediaHandler, derivativeKey, thumbKey, type ClaimedMediaJob, type MediaStorage } from './handler.ts';

const KEY = 'service-key';
const OWNER = '0a0a0a0a-0000-4000-8000-00000000000a';
const MEDIA = '1b1b1b1b-0000-4000-8000-000000000001';

const job = (patch: Partial<ClaimedMediaJob> = {}): ClaimedMediaJob => ({
  media_id: MEDIA, lease_token: 'lease-1', attempt: 1, owner_id: OWNER, post_id: 'p1',
  storage_key: `${OWNER}/batch/0.jpg`, mime_type: 'image/jpeg', size_bytes: 5000,
  object_size: 5000, object_mimetype: 'image/jpeg', ...patch,
});

const realJpeg = async () => new Uint8Array(await new Jimp({ width: 64, height: 48, color: 0x112233ff }).getBuffer('image/jpeg', { quality: 90 }));

interface Harness {
  calls: { fn: string; args: Record<string, unknown> }[];
  downloads: { key: string; maxBytes: number }[];
  uploads: string[];
  run: (body?: unknown) => Promise<Record<string, unknown>>;
}

function harness(opts: {
  jobs: ClaimedMediaJob[];
  bytes?: Uint8Array;
  complete?: string | { error: string };
  storage?: Partial<MediaStorage>;
  budgetMs?: number;
  clock?: () => number;
}): Harness {
  const calls: Harness['calls'] = [];
  const downloads: Harness['downloads'] = [];
  const uploads: string[] = [];
  const handler = createProcessPostMediaHandler({
    serviceRoleKey: KEY,
    budgetMs: opts.budgetMs,
    now: opts.clock,
    rpc: (fn, args) => {
      calls.push({ fn, args });
      // The worker claims one job per call; the queue double hands them out in order.
      if (fn === 'post_media_processing_claim') return Promise.resolve({ data: opts.jobs.splice(0, 1), error: null });
      if (fn === 'post_media_processing_complete') {
        const c = opts.complete ?? 'ready';
        return Promise.resolve(typeof c === 'string' ? { data: c, error: null } : { data: null, error: { message: c.error } });
      }
      return Promise.resolve({ data: args.p_retryable ? 'retry' : 'failed', error: null });
    },
    storage: {
      download: opts.storage?.download ?? ((key, maxBytes) => {
        downloads.push({ key, maxBytes });
        return Promise.resolve(opts.bytes ?? new Uint8Array(0));
      }),
      upload: opts.storage?.upload ?? ((key) => {
        uploads.push(key);
        return Promise.resolve();
      }),
    },
  });
  const run = async (body: unknown = {}) => {
    const res = await handler(new Request('https://x/functions/v1/process-post-media', {
      method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: JSON.stringify(body),
    }));
    return await res.json();
  };
  return { calls, downloads, uploads, run };
}

const failCall = (h: Harness) => h.calls.find((c) => c.fn === 'post_media_processing_fail')?.args;

Deno.test('refuses callers without the service-role key before any work', async () => {
  let claimed = false;
  const handler = createProcessPostMediaHandler({
    serviceRoleKey: KEY,
    rpc: () => {
      claimed = true;
      return Promise.resolve({ data: [], error: null });
    },
    storage: { download: () => Promise.reject(), upload: () => Promise.reject() },
  });
  const res = await handler(new Request('https://x', { method: 'POST', headers: { Authorization: 'Bearer anon-key' } }));
  assertEquals(res.status, 401);
  assertEquals(claimed, false);
});

Deno.test('happy path: claims a bounded batch, writes this attempt\'s own derivative + thumb, completes with the exact key', async () => {
  const h = harness({ jobs: [job()], bytes: await realJpeg() });
  const out = await h.run({ limit: 99 });
  assertEquals(h.calls[0], { fn: 'post_media_processing_claim', args: { p_limit: 1, p_lease_seconds: 300 } });
  const key = derivativeKey(OWNER, MEDIA, 1);
  assertEquals(key, `${OWNER}/derived/${MEDIA}-a1.jpg`);
  assertEquals(h.uploads, [key, thumbKey(key)]);
  assert(!h.uploads.includes(job().storage_key), 'the original is never written');
  assertEquals(h.downloads, [{ key: job().storage_key, maxBytes: 5000 }]);
  const complete = h.calls.find((c) => c.fn === 'post_media_processing_complete')!.args;
  assertEquals(complete.p_derivative_key, key);
  assertEquals([complete.p_width, complete.p_height], [64, 48]);
  assertEquals(out.outcomes, { [MEDIA]: 'ready' });
});

Deno.test('a foreign-owner or climbing path is refused before download, as final', async () => {
  for (const storage_key of [`${'9'.repeat(8)}-0000-4000-8000-000000000009/x.jpg`, `${OWNER}/../other/x.jpg`, 'x.jpg']) {
    const h = harness({ jobs: [job({ storage_key })] });
    await h.run();
    assertEquals(h.downloads, []);
    assertEquals(failCall(h), { p_media_id: MEDIA, p_lease_token: 'lease-1', p_error: 'foreign_or_invalid_path', p_retryable: false });
  }
});

Deno.test('oversize, missing or non-image objects are refused from Storage metadata, before download', async () => {
  for (const [patch, code] of [
    [{ object_size: 9 * 1024 * 1024 }, 'too_large'],
    [{ object_size: null }, 'object_missing'],
    [{ object_mimetype: 'image/svg+xml' }, 'unsupported_type'],
  ] as const) {
    const h = harness({ jobs: [job(patch as Partial<ClaimedMediaJob>)] });
    await h.run();
    assertEquals(h.downloads, []);
    assertEquals(failCall(h)?.p_error, code);
    assertEquals(failCall(h)?.p_retryable, false);
  }
});

Deno.test('bytes that are not an image (wrong magic) fail as final, with nothing uploaded', async () => {
  const h = harness({ jobs: [job()], bytes: new TextEncoder().encode('<html>not a photo</html>') });
  const out = await h.run();
  assertEquals(h.uploads, []);
  assertEquals(failCall(h)?.p_error, 'not_an_image');
  assertEquals(out.outcomes, { [MEDIA]: 'failed' });
});

Deno.test('a download error or an over-cap stream retries (transient)', async () => {
  const h = harness({ jobs: [job()], storage: { download: () => Promise.reject(new Error('object larger than recorded (> 5000)')) } });
  const out = await h.run();
  assertEquals(failCall(h)?.p_retryable, true);
  assertEquals(out.outcomes, { [MEDIA]: 'retry' });
});

Deno.test('a concurrent attempt that already won: completion answers stale/changed and nothing else happens', async () => {
  for (const answer of ['stale', 'changed']) {
    const h = harness({ jobs: [job({ attempt: 2 })], bytes: await realJpeg(), complete: answer });
    const out = await h.run();
    assertEquals(out.outcomes, { [MEDIA]: answer });
    assertEquals(failCall(h), undefined, 'a lost race is not recorded as a failure');
    // Attempt 2 wrote only its own keys; attempt 1's objects (if any) are untouched.
    assertEquals(h.uploads, [derivativeKey(OWNER, MEDIA, 2), thumbKey(derivativeKey(OWNER, MEDIA, 2))]);
  }
});

Deno.test('a refused completion (e.g. object not in Storage yet) retries, and an upload error retries', async () => {
  const refused = harness({ jobs: [job()], bytes: await realJpeg(), complete: { error: 'derivative_not_stored' } });
  await refused.run();
  assertEquals(failCall(refused)?.p_error, 'complete: derivative_not_stored');
  assertEquals(failCall(refused)?.p_retryable, true);
  const upload = harness({ jobs: [job()], bytes: await realJpeg(), storage: { upload: () => Promise.reject(new Error('The resource already exists')) } });
  await upload.run();
  assertEquals(failCall(upload)?.p_error, 'upload: The resource already exists');
});

Deno.test('claims one job at a time, up to the limit, and stops claiming when the budget is spent', async () => {
  const bytes = await realJpeg();
  const many = harness({ jobs: [job(), job({ media_id: 'm2' }), job({ media_id: 'm3' })], bytes });
  const out = await many.run({ limit: 2 });
  assertEquals(many.calls.filter((c) => c.fn === 'post_media_processing_claim').length, 2);
  assertEquals(Object.keys(out.outcomes as object), [MEDIA, 'm2']);
  let t = 0;
  const slow = harness({ jobs: [job(), job({ media_id: 'm2' })], bytes, budgetMs: 10, clock: () => (t += 20) });
  const none = await slow.run();
  // Out of time before the first claim: nothing is claimed, so no attempt is spent.
  assertEquals(slow.calls, []);
  assertEquals(none.claimed, 0);
});
