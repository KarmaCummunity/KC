// run: deno test --allow-read (from supabase/functions). Mocked I/O only.
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { Jimp } from 'https://esm.sh/jimp@1.6.0';
import { createProcessPostMediaHandler, derivativeKey, thumbKey, type ClaimedMediaJob, type MediaStorage } from './handler.ts';

const KEY = 'service-key';
const OWNER = '0a0a0a0a-0000-4000-8000-00000000000a';
const MEDIA = '1b1b1b1b-0000-4000-8000-000000000001';

/** A lease well in the future unless a test says otherwise. */
const LEASE_END = new Date(Date.now() + 300_000).toISOString();

const job = (patch: Partial<ClaimedMediaJob> = {}): ClaimedMediaJob => ({
  media_id: MEDIA, lease_token: 'lease-1', attempt: 1, owner_id: OWNER, post_id: 'p1', leased_until: LEASE_END,
  storage_key: `${OWNER}/batch/0.jpg`, mime_type: 'image/jpeg', size_bytes: 5000,
  object_size: 5000, object_mimetype: 'image/jpeg', ...patch,
});

const realJpeg = async (width = 64, height = 48) =>
  new Uint8Array(await new Jimp({ width, height, color: 0x112233ff }).getBuffer('image/jpeg', { quality: 90 }));
const realPng = async (width = 64, height = 48) =>
  new Uint8Array(await new Jimp({ width, height, color: 0x112233ff }).getBuffer('image/png'));
const isThumb = (key: string) => /-thumb\.[a-z]+$/.test(key);

interface Harness {
  calls: { fn: string; args: Record<string, unknown> }[];
  downloads: { key: string; maxBytes: number }[];
  uploads: string[];
  /** Bytes and content type of each upload, by key. */
  stored: Map<string, { bytes: Uint8Array; contentType: string }>;
  removed: string[];
  signals: AbortSignal[];
  rpcSignals: AbortSignal[];
  removeSignals: AbortSignal[];
  run: (body?: unknown) => Promise<Record<string, unknown>>;
}

/** Never settles on its own; rejects as soon as `signal` aborts (an unresponsive server). */
function hangUntilAborted<T>(signal: AbortSignal): Promise<T> {
  return new Promise<T>((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
}

function harness(opts: {
  /** Operations that never answer: RPC names, 'download' or 'upload'. */
  hang?: string[];
  deadlines?: { rpcMs?: number; downloadMs?: number; uploadMs?: number; cleanupMs?: number };
  jobs: ClaimedMediaJob[];
  bytes?: Uint8Array;
  /** The uploader's `-thumb` sibling; absent (null) unless a test provides it. */
  thumb?: Uint8Array;
  complete?: string | { error: string };
  storage?: Partial<MediaStorage>;
  budgetMs?: number;
  clock?: () => number;
}): Harness {
  const calls: Harness['calls'] = [];
  const downloads: Harness['downloads'] = [];
  const uploads: string[] = [];
  const stored: Harness['stored'] = new Map();
  const removed: string[] = [];
  const signals: AbortSignal[] = [];
  const rpcSignals: AbortSignal[] = [];
  const removeSignals: AbortSignal[] = [];
  const hang = new Set(opts.hang ?? []);
  const handler = createProcessPostMediaHandler({
    serviceRoleKey: KEY,
    budgetMs: opts.budgetMs,
    now: opts.clock,
    deadlines: opts.deadlines,
    rpc: (fn, args, signal) => {
      calls.push({ fn, args });
      rpcSignals.push(signal);
      if (hang.has(fn)) return hangUntilAborted(signal);
      // The worker claims one job per call; the queue double hands them out in order.
      if (fn === 'post_media_processing_claim') return Promise.resolve({ data: opts.jobs.splice(0, 1), error: null });
      if (fn === 'post_media_processing_complete') {
        const c = opts.complete ?? 'ready';
        return Promise.resolve(typeof c === 'string' ? { data: c, error: null } : { data: null, error: { message: c.error } });
      }
      return Promise.resolve({ data: args.p_retryable ? 'retry' : 'failed', error: null });
    },
    storage: {
      download: opts.storage?.download ?? ((key, maxBytes, signal) => {
        downloads.push({ key, maxBytes });
        if (hang.has('download')) return hangUntilAborted(signal);
        return Promise.resolve(isThumb(key) ? opts.thumb ?? null : opts.bytes ?? new Uint8Array(0));
      }),
      upload: opts.storage?.upload ?? ((key, bytes, contentType, signal) => {
        uploads.push(key);
        stored.set(key, { bytes, contentType });
        signals.push(signal);
        if (hang.has('upload')) return hangUntilAborted(signal);
        return Promise.resolve();
      }),
      remove: (keys, signal) => {
        removed.push(...keys);
        removeSignals.push(signal);
        if (hang.has('remove')) return hangUntilAborted(signal);
        return Promise.resolve();
      },
    },
  });
  const run = async (body: unknown = {}) => {
    const res = await handler(new Request('https://x/functions/v1/process-post-media', {
      method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: JSON.stringify(body),
    }));
    return await res.json();
  };
  return { calls, downloads, uploads, stored, removed, signals, rpcSignals, removeSignals, run };
}

const failCall = (h: Harness) => h.calls.find((c) => c.fn === 'post_media_processing_fail')?.args;

Deno.test('refuses callers without the service-role key before any work', async () => {
  let claimed = false;
  const handler = createProcessPostMediaHandler({
    serviceRoleKey: KEY,
    rpc: (_fn, _args, _signal) => {
      claimed = true;
      return Promise.resolve({ data: [], error: null });
    },
    storage: { download: () => Promise.reject(), upload: () => Promise.reject(), remove: (_keys, _signal) => Promise.resolve() },
  });
  const res = await handler(new Request('https://x', { method: 'POST', headers: { Authorization: 'Bearer anon-key' } }));
  assertEquals(res.status, 401);
  assertEquals(claimed, false);
});

// The deploy smoke (scripts/edge-functions.mjs SMOKE_PROBES) sends an OPTIONS request and expects 405.
Deno.test('answers a non-POST request with 405 before the key check or any work', async () => {
  let called = false;
  const handler = createProcessPostMediaHandler({
    serviceRoleKey: KEY,
    rpc: (_fn, _args, _signal) => {
      called = true;
      return Promise.resolve({ data: [], error: null });
    },
    storage: { download: () => Promise.reject(), upload: () => Promise.reject(), remove: (_keys, _signal) => Promise.resolve() },
  });
  const res = await handler(new Request('https://x', { method: 'OPTIONS' }));
  assertEquals(res.status, 405);
  assertEquals(called, false);
});

Deno.test('happy path: claims a bounded batch, writes this attempt\'s own derivative + thumb, completes with the exact key', async () => {
  const h = harness({ jobs: [job()], bytes: await realJpeg(), thumb: await realJpeg(16, 12) });
  const out = await h.run({ limit: 99 });
  assertEquals(h.calls[0], { fn: 'post_media_processing_claim', args: { p_limit: 1, p_lease_seconds: 300 } });
  const key = derivativeKey(OWNER, MEDIA, 1);
  // The service-only namespace, never inside the member-writable owner folder.
  assertEquals(key, `derived/${OWNER}/${MEDIA}-a1.jpg`);
  assertEquals(h.uploads, [key, thumbKey(key)]);
  assert(!h.uploads.includes(job().storage_key), 'the original is never written');
  assertEquals(h.downloads, [{ key: job().storage_key, maxBytes: 5000 }, { key: thumbKey(job().storage_key), maxBytes: 1024 * 1024 }]);
  assertEquals([...h.stored.values()].map((o) => o.contentType), ['image/jpeg', 'image/jpeg']);
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
    const h = harness({ jobs: [job({ attempt: 2 })], bytes: await realJpeg(), thumb: await realJpeg(16, 12), complete: answer });
    const out = await h.run();
    assertEquals(out.outcomes, { [MEDIA]: answer });
    assertEquals(failCall(h), undefined, 'a lost race is not recorded as a failure');
    // Its objects are never referenced: the worker removes them itself (purge race, KC#2316).
    assertEquals(h.removed, [derivativeKey(OWNER, MEDIA, 2), thumbKey(derivativeKey(OWNER, MEDIA, 2))]);
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

Deno.test('no upload starts within the last 30 s of the lease, and none outlives it', async () => {
  const nearEnd = harness({ jobs: [job({ leased_until: new Date(Date.now() + 10_000).toISOString() })], bytes: await realJpeg() });
  const out = await nearEnd.run();
  assertEquals(nearEnd.uploads, [], 'a lease about to end writes nothing');
  assertEquals(out.outcomes, { [MEDIA]: 'stale' });
  const normal = harness({ jobs: [job()], bytes: await realJpeg(), thumb: await realJpeg(16, 12) });
  await normal.run();
  assertEquals(normal.signals.length, 2);
  assert(normal.signals.every((s) => s instanceof AbortSignal), 'every upload is abortable at the lease deadline');
});

Deno.test('a failure after the first upload removes what this attempt wrote', async () => {
  let n = 0;
  const h = harness({
    jobs: [job()], bytes: await realJpeg(), thumb: await realJpeg(16, 12),
    storage: { upload: () => (++n === 2 ? Promise.reject(new Error('thumb failed')) : Promise.resolve()) },
  });
  await h.run();
  assertEquals(h.removed, [derivativeKey(OWNER, MEDIA, 1), thumbKey(derivativeKey(OWNER, MEDIA, 1))]);
  assertEquals(failCall(h)?.p_retryable, true);
});

// ── Finite deadlines on every database call, download and upload ─────────────────────────────

const FAST = { rpcMs: 30, downloadMs: 30, uploadMs: 30, cleanupMs: 30 };

Deno.test('a claim the database never answers is aborted at its deadline and the run ends', async () => {
  const h = harness({ jobs: [job()], hang: ['post_media_processing_claim'], deadlines: FAST });
  const out = await h.run();
  assertEquals(out, { ok: false, error: 'deadline_exceeded: rpc post_media_processing_claim', outcomes: {} });
  assert(h.rpcSignals[0]?.aborted, 'the request itself is aborted, not only abandoned');
});

Deno.test('a download that never completes is aborted and the job retries', async () => {
  const h = harness({ jobs: [job()], hang: ['download'], deadlines: FAST });
  const out = await h.run();
  assertEquals(out.outcomes, { [MEDIA]: 'retry' });
  assertEquals(failCall(h)?.p_error, 'download: deadline_exceeded: download');
  assertEquals(h.uploads, []);
});

Deno.test('an upload that never completes is aborted, cleaned up, and the job retries', async () => {
  const h = harness({ jobs: [job()], bytes: await realJpeg(), hang: ['upload'], deadlines: FAST });
  const out = await h.run();
  assertEquals(out.outcomes, { [MEDIA]: 'retry' });
  assert(h.signals[0]?.aborted, 'the upload request is aborted');
  assertEquals(h.removed, [derivativeKey(OWNER, MEDIA, 1)]);
});

Deno.test('a completion with no answer is "unknown": nothing is removed and no failure is recorded', async () => {
  const h = harness({ jobs: [job()], bytes: await realJpeg(), hang: ['post_media_processing_complete'], deadlines: FAST });
  const out = await h.run();
  // It may have committed: deleting the copy could break a ready row. The lease decides.
  assertEquals(out.outcomes, { [MEDIA]: 'unknown' });
  assertEquals(h.removed, []);
  assertEquals(failCall(h), undefined);
});

Deno.test('a cleanup delete that never answers is aborted at its deadline; the job still records its failure', async () => {
  const h = harness({ jobs: [job()], bytes: await realJpeg(), hang: ['upload', 'remove'], deadlines: FAST });
  const out = await h.run();
  assertEquals(out.outcomes, { [MEDIA]: 'retry' });
  assert(h.removeSignals[0]?.aborted, 'the delete request is aborted, not left hanging');
  assertEquals(failCall(h)?.p_retryable, true);
});

// ── What is written: the upload's own type, no metadata, an optional thumb ───────────────────

Deno.test('the uploaded copy is the sanitized file: a GPS block in the upload never reaches Storage', async () => {
  const photo = await realJpeg();
  const payload = new TextEncoder().encode('Exif\0\0GPS-32.0853N-34.78E');
  const gps = [0xff, 0xe1, 0x00, payload.length + 2, ...payload];
  const h = harness({ jobs: [job()], bytes: new Uint8Array([...photo.slice(0, 2), ...gps, ...photo.slice(2)]) });
  const out = await h.run();
  assertEquals(out.outcomes, { [MEDIA]: 'ready' });
  const copy = h.stored.get(derivativeKey(OWNER, MEDIA, 1))!;
  assert(!new TextDecoder('latin1').decode(copy.bytes).includes('GPS-32'));
  assertEquals(h.calls.find((c) => c.fn === 'post_media_processing_complete')!.args.p_size_bytes, copy.bytes.byteLength);
});

Deno.test('a PNG upload gets a .png copy of its own type; a thumb of another type is not used', async () => {
  const h = harness({
    jobs: [job({ storage_key: `${OWNER}/batch/0.png`, object_mimetype: 'image/png', mime_type: 'image/png' })],
    bytes: await realPng(), thumb: await realJpeg(16, 12),
  });
  const out = await h.run();
  const key = derivativeKey(OWNER, MEDIA, 1, 'image/png');
  assertEquals(key, `derived/${OWNER}/${MEDIA}-a1.png`);
  assertEquals(h.uploads, [key]);
  assertEquals(h.stored.get(key)!.contentType, 'image/png');
  assertEquals(h.calls.find((c) => c.fn === 'post_media_processing_complete')!.args.p_derivative_key, key);
  assertEquals(out.outcomes, { [MEDIA]: 'ready' });
});

Deno.test('a missing, invalid or unreadable thumb costs only the thumb: the photo is still made ready', async () => {
  const cases: Partial<Parameters<typeof harness>[0]>[] = [
    {}, // no thumb uploaded
    { thumb: new TextEncoder().encode('<svg/>') },
    { thumb: await realJpeg(1600, 1200) }, // bigger than any thumb the app makes
  ];
  const photo = await realJpeg();
  for (const patch of cases) {
    const h = harness({ jobs: [job()], bytes: photo, ...patch });
    const out = await h.run();
    assertEquals(h.uploads, [derivativeKey(OWNER, MEDIA, 1)]);
    assertEquals(out.outcomes, { [MEDIA]: 'ready' });
  }
  const flaky = harness({
    jobs: [job()],
    storage: { download: (key) => isThumb(key) ? Promise.reject(new Error('network')) : Promise.resolve(photo) },
  });
  assertEquals((await flaky.run()).outcomes, { [MEDIA]: 'ready' });
});

Deno.test('an object Storage no longer has fails as final (object_missing), with nothing written', async () => {
  const h = harness({ jobs: [job()], storage: { download: () => Promise.resolve(null) } });
  const out = await h.run();
  assertEquals(failCall(h), { p_media_id: MEDIA, p_lease_token: 'lease-1', p_error: 'object_missing', p_retryable: false });
  assertEquals(h.uploads, []);
  assertEquals(out.outcomes, { [MEDIA]: 'failed' });
});

Deno.test('a run claims 3 jobs by default and at most 5', async () => {
  const bytes = await realJpeg();
  const queue = () => Array.from({ length: 7 }, (_, n) => job({ media_id: `m${n}` }));
  const claims = (h: Harness) => h.calls.filter((c) => c.fn === 'post_media_processing_claim').length;
  const byDefault = harness({ jobs: queue(), bytes });
  await byDefault.run();
  const capped = harness({ jobs: queue(), bytes });
  await capped.run({ limit: 99 });
  assertEquals([claims(byDefault), claims(capped)], [3, 5]);
});
