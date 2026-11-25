import { describe, expect, it } from 'vitest';
import { type ClaimedMediaJob, ClaimFailedError, derivativeKey, thumbKey } from '../processPostMedia';
import { failCall, type Harness, harness, isThumb, job, MEDIA, OWNER, realJpeg, realPng } from './postMediaHarness';

describe('processPostMedia', () => {
  it('happy path: claims a bounded batch, writes this attempt\'s own derivative + thumb, completes with the exact key', async () => {
    const h = harness({ jobs: [job()], bytes: await realJpeg(), thumb: await realJpeg(16, 12) });
    const out = await h.run({ limit: 99 });
    expect(h.calls[0]).toEqual({ fn: 'post_media_processing_claim', args: { p_limit: 1, p_lease_seconds: 300 } });
    const key = derivativeKey(OWNER, MEDIA, 1);
    // The service-only namespace, never inside the member-writable owner folder.
    expect(key).toEqual(`derived/${OWNER}/${MEDIA}-a1.jpg`);
    expect(h.uploads).toEqual([key, thumbKey(key)]);
    expect(!h.uploads.includes(job().storage_key), 'the original is never written').toBeTruthy();
    expect(h.downloads).toEqual([{ key: job().storage_key, maxBytes: 5000 }, { key: thumbKey(job().storage_key), maxBytes: 1024 * 1024 }]);
    expect([...h.stored.values()].map((o) => o.contentType)).toEqual(['image/jpeg', 'image/jpeg']);
    const complete = h.calls.find((c) => c.fn === 'post_media_processing_complete')!.args;
    expect(complete.p_derivative_key).toEqual(key);
    expect([complete.p_width, complete.p_height]).toEqual([64, 48]);
    expect(out.outcomes).toEqual({ [MEDIA]: 'ready' });
  });

  it('a foreign-owner or climbing path is refused before download, as final', async () => {
    for (const storage_key of [`${'9'.repeat(8)}-0000-4000-8000-000000000009/x.jpg`, `${OWNER}/../other/x.jpg`, 'x.jpg']) {
      const h = harness({ jobs: [job({ storage_key })] });
      await h.run();
      expect(h.downloads).toEqual([]);
      expect(failCall(h)).toEqual({ p_media_id: MEDIA, p_lease_token: 'lease-1', p_error: 'foreign_or_invalid_path', p_retryable: false });
    }
  });

  it('oversize, missing or non-image objects are refused from Storage metadata, before download', async () => {
    for (const [patch, code] of [
      [{ object_size: 9 * 1024 * 1024 }, 'too_large'],
      [{ object_size: null }, 'object_missing'],
      [{ object_mimetype: 'image/svg+xml' }, 'unsupported_type'],
    ] as const) {
      const h = harness({ jobs: [job(patch as Partial<ClaimedMediaJob>)] });
      await h.run();
      expect(h.downloads).toEqual([]);
      expect(failCall(h)?.p_error).toEqual(code);
      expect(failCall(h)?.p_retryable).toEqual(false);
    }
  });

  it('bytes that are not an image (wrong magic) fail as final, with nothing uploaded', async () => {
    const h = harness({ jobs: [job()], bytes: new TextEncoder().encode('<html>not a photo</html>') });
    const out = await h.run();
    expect(h.uploads).toEqual([]);
    expect(failCall(h)?.p_error).toEqual('not_an_image');
    expect(out.outcomes).toEqual({ [MEDIA]: 'failed' });
  });

  it('a download error or an over-cap stream retries (transient)', async () => {
    const h = harness({ jobs: [job()], storage: { download: () => Promise.reject(new Error('object larger than recorded (> 5000)')) } });
    const out = await h.run();
    expect(failCall(h)?.p_retryable).toEqual(true);
    expect(out.outcomes).toEqual({ [MEDIA]: 'retry' });
  });

  it('a concurrent attempt that already won: completion answers stale/changed and nothing else happens', async () => {
    for (const answer of ['stale', 'changed']) {
      const h = harness({ jobs: [job({ attempt: 2 })], bytes: await realJpeg(), thumb: await realJpeg(16, 12), complete: answer });
      const out = await h.run();
      expect(out.outcomes).toEqual({ [MEDIA]: answer });
      expect(failCall(h), 'a lost race is not recorded as a failure').toEqual(undefined);
      // Its objects are never referenced: the worker removes them itself (purge race, KC#2316).
      expect(h.removed).toEqual([derivativeKey(OWNER, MEDIA, 2), thumbKey(derivativeKey(OWNER, MEDIA, 2))]);
      // Attempt 2 wrote only its own keys; attempt 1's objects (if any) are untouched.
      expect(h.uploads).toEqual([derivativeKey(OWNER, MEDIA, 2), thumbKey(derivativeKey(OWNER, MEDIA, 2))]);
    }
  });

  it('a refused completion (e.g. object not in Storage yet) retries, and an upload error retries', async () => {
    const refused = harness({ jobs: [job()], bytes: await realJpeg(), complete: { error: 'derivative_not_stored' } });
    await refused.run();
    expect(failCall(refused)?.p_error).toEqual('complete: derivative_not_stored');
    expect(failCall(refused)?.p_retryable).toEqual(true);
    const upload = harness({ jobs: [job()], bytes: await realJpeg(), storage: { upload: () => Promise.reject(new Error('The resource already exists')) } });
    await upload.run();
    expect(failCall(upload)?.p_error).toEqual('upload: The resource already exists');
  });

  it('claims one job at a time, up to the limit, and stops claiming when the budget is spent', async () => {
    const bytes = await realJpeg();
    const many = harness({ jobs: [job(), job({ media_id: 'm2' }), job({ media_id: 'm3' })], bytes });
    const out = await many.run({ limit: 2 });
    expect(many.calls.filter((c) => c.fn === 'post_media_processing_claim').length).toEqual(2);
    expect(Object.keys(out.outcomes as object)).toEqual([MEDIA, 'm2']);
    let t = 0;
    const slow = harness({ jobs: [job(), job({ media_id: 'm2' })], bytes, budgetMs: 10, clock: () => (t += 20) });
    const none = await slow.run();
    // Out of time before the first claim: nothing is claimed, so no attempt is spent.
    expect(slow.calls).toEqual([]);
    expect(none.claimed).toEqual(0);
  });

  it('no upload starts within the last 30 s of the lease, and none outlives it', async () => {
    const nearEnd = harness({ jobs: [job({ leased_until: new Date(Date.now() + 10_000).toISOString() })], bytes: await realJpeg() });
    const out = await nearEnd.run();
    expect(nearEnd.uploads, 'a lease about to end writes nothing').toEqual([]);
    expect(out.outcomes).toEqual({ [MEDIA]: 'stale' });
    const normal = harness({ jobs: [job()], bytes: await realJpeg(), thumb: await realJpeg(16, 12) });
    await normal.run();
    expect(normal.signals.length).toEqual(2);
    expect(normal.signals.every((s) => s instanceof AbortSignal), 'every upload is abortable at the lease deadline').toBeTruthy();
  });

  it('a failure after the first upload removes what this attempt wrote', async () => {
    let n = 0;
    const h = harness({
      jobs: [job()], bytes: await realJpeg(), thumb: await realJpeg(16, 12),
      storage: { upload: () => (++n === 2 ? Promise.reject(new Error('thumb failed')) : Promise.resolve()) },
    });
    await h.run();
    expect(h.removed).toEqual([derivativeKey(OWNER, MEDIA, 1), thumbKey(derivativeKey(OWNER, MEDIA, 1))]);
    expect(failCall(h)?.p_retryable).toEqual(true);
  });

  // ── Finite deadlines on every database call, download and upload ─────────────────────────────

  const FAST = { rpcMs: 30, downloadMs: 30, uploadMs: 30, cleanupMs: 30 };

  it('a claim the database never answers is aborted at its deadline and the run ends', async () => {
    const h = harness({ jobs: [job()], hang: ['post_media_processing_claim'], deadlines: FAST });
    const failure = await h.run().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ClaimFailedError);
    expect(failure).toMatchObject({ message: 'post_media_processing_claim: deadline_exceeded: rpc post_media_processing_claim', outcomes: {} });
    expect(h.rpcSignals[0]?.aborted, 'the request itself is aborted, not only abandoned').toBeTruthy();
  });

  it('a download that never completes is aborted and the job retries', async () => {
    const h = harness({ jobs: [job()], hang: ['download'], deadlines: FAST });
    const out = await h.run();
    expect(out.outcomes).toEqual({ [MEDIA]: 'retry' });
    expect(failCall(h)?.p_error).toEqual('download: deadline_exceeded: download');
    expect(h.uploads).toEqual([]);
  });

  it('an upload that never completes is aborted, cleaned up, and the job retries', async () => {
    const h = harness({ jobs: [job()], bytes: await realJpeg(), hang: ['upload'], deadlines: FAST });
    const out = await h.run();
    expect(out.outcomes).toEqual({ [MEDIA]: 'retry' });
    expect(h.signals[0]?.aborted, 'the upload request is aborted').toBeTruthy();
    expect(h.removed).toEqual([derivativeKey(OWNER, MEDIA, 1)]);
  });

  it('a completion with no answer is "unknown": nothing is removed and no failure is recorded', async () => {
    const h = harness({ jobs: [job()], bytes: await realJpeg(), hang: ['post_media_processing_complete'], deadlines: FAST });
    const out = await h.run();
    // It may have committed: deleting the copy could break a ready row. The lease decides.
    expect(out.outcomes).toEqual({ [MEDIA]: 'unknown' });
    expect(h.removed).toEqual([]);
    expect(failCall(h)).toEqual(undefined);
  });

  it('a cleanup delete that never answers is aborted at its deadline; the job still records its failure', async () => {
    const h = harness({ jobs: [job()], bytes: await realJpeg(), hang: ['upload', 'remove'], deadlines: FAST });
    const out = await h.run();
    expect(out.outcomes).toEqual({ [MEDIA]: 'retry' });
    expect(h.removeSignals[0]?.aborted, 'the delete request is aborted, not left hanging').toBeTruthy();
    expect(failCall(h)?.p_retryable).toEqual(true);
  });

  // ── What is written: the upload's own type, no metadata, an optional thumb ───────────────────

  it('the uploaded copy is the sanitized file: a GPS block in the upload never reaches Storage', async () => {
    const photo = await realJpeg();
    const payload = new TextEncoder().encode('Exif\0\0GPS-32.0853N-34.78E');
    const gps = [0xff, 0xe1, 0x00, payload.length + 2, ...payload];
    const h = harness({ jobs: [job()], bytes: new Uint8Array([...photo.slice(0, 2), ...gps, ...photo.slice(2)]) });
    const out = await h.run();
    expect(out.outcomes).toEqual({ [MEDIA]: 'ready' });
    const copy = h.stored.get(derivativeKey(OWNER, MEDIA, 1))!;
    expect(!new TextDecoder('latin1').decode(copy.bytes).includes('GPS-32')).toBeTruthy();
    expect(h.calls.find((c) => c.fn === 'post_media_processing_complete')!.args.p_size_bytes).toEqual(copy.bytes.byteLength);
  });

  it('a PNG upload gets a .png copy of its own type; a thumb of another type is not used', async () => {
    const h = harness({
      jobs: [job({ storage_key: `${OWNER}/batch/0.png`, object_mimetype: 'image/png', mime_type: 'image/png' })],
      bytes: await realPng(), thumb: await realJpeg(16, 12),
    });
    const out = await h.run();
    const key = derivativeKey(OWNER, MEDIA, 1, 'image/png');
    expect(key).toEqual(`derived/${OWNER}/${MEDIA}-a1.png`);
    expect(h.uploads).toEqual([key]);
    expect(h.stored.get(key)!.contentType).toEqual('image/png');
    expect(h.calls.find((c) => c.fn === 'post_media_processing_complete')!.args.p_derivative_key).toEqual(key);
    expect(out.outcomes).toEqual({ [MEDIA]: 'ready' });
  });

  it('a missing, invalid or unreadable thumb costs only the thumb: the photo is still made ready', async () => {
    const cases: Partial<Parameters<typeof harness>[0]>[] = [
      {}, // no thumb uploaded
      { thumb: new TextEncoder().encode('<svg/>') },
      { thumb: await realJpeg(1600, 1200) }, // bigger than any thumb the app makes
    ];
    const photo = await realJpeg();
    for (const patch of cases) {
      const h = harness({ jobs: [job()], bytes: photo, ...patch });
      const out = await h.run();
      expect(h.uploads).toEqual([derivativeKey(OWNER, MEDIA, 1)]);
      expect(out.outcomes).toEqual({ [MEDIA]: 'ready' });
    }
    const flaky = harness({
      jobs: [job()],
      storage: { download: (key) => isThumb(key) ? Promise.reject(new Error('network')) : Promise.resolve(photo) },
    });
    expect((await flaky.run()).outcomes).toEqual({ [MEDIA]: 'ready' });
  });

  it('an object Storage no longer has fails as final (object_missing), with nothing written', async () => {
    const h = harness({ jobs: [job()], storage: { download: () => Promise.resolve(null) } });
    const out = await h.run();
    expect(failCall(h)).toEqual({ p_media_id: MEDIA, p_lease_token: 'lease-1', p_error: 'object_missing', p_retryable: false });
    expect(h.uploads).toEqual([]);
    expect(out.outcomes).toEqual({ [MEDIA]: 'failed' });
  });

  it('a run claims 3 jobs by default and at most 5', async () => {
    const bytes = await realJpeg();
    const queue = () => Array.from({ length: 7 }, (_, n) => job({ media_id: `m${n}` }));
    const claims = (h: Harness) => h.calls.filter((c) => c.fn === 'post_media_processing_claim').length;
    const byDefault = harness({ jobs: queue(), bytes });
    await byDefault.run();
    const capped = harness({ jobs: queue(), bytes });
    await capped.run({ limit: 99 });
    expect([claims(byDefault), claims(capped)]).toEqual([3, 5]);
  });

  // ADR-012: everyone is shown the copy, so the upload, which may carry where it was taken, goes.
  it('removes the member\'s upload and its thumbnail once the photo is ready, and never the copy', async () => {
    const h = harness({ jobs: [job()], bytes: await realJpeg(), thumb: await realJpeg(16, 12) });

    expect((await h.run()).outcomes).toEqual({ [MEDIA]: 'ready' });

    expect(h.removed).toEqual([job().storage_key, thumbKey(job().storage_key)]);
    expect(h.removed).not.toContain(derivativeKey(OWNER, MEDIA, 1));
  });

  it.each([
    ['another attempt won', { complete: 'stale' }],
    ['the post changed meanwhile', { complete: 'changed' }],
    ['the completion was refused', { complete: { error: 'derivative_not_stored' } }],
  ] as const)('keeps the upload when %s: the photo still depends on it', async (_case, options) => {
    const h = harness({ jobs: [job()], bytes: await realJpeg(), ...options });

    await h.run();

    expect(h.removed).not.toContain(job().storage_key);
  });

  it('keeps the upload when the completion was never answered: it may not have happened', async () => {
    const h = harness({ jobs: [job()], bytes: await realJpeg(), hang: ['post_media_processing_complete'], deadlines: { rpcMs: 30, downloadMs: 30, uploadMs: 30, cleanupMs: 30 } });

    expect((await h.run()).outcomes).toEqual({ [MEDIA]: 'unknown' });
    expect(h.removed).toEqual([]);
  });

  it('still reports the photo ready when the upload cannot be removed, and logs it for the reconciliation to finish', async () => {
    const h = harness({ jobs: [job()], bytes: await realJpeg(), hang: ['remove'], deadlines: { rpcMs: 30, downloadMs: 30, uploadMs: 30, cleanupMs: 30 } });

    expect((await h.run()).outcomes).toEqual({ [MEDIA]: 'ready' });
    expect(h.logged).toEqual(['warn remove upload']);
  });
});
