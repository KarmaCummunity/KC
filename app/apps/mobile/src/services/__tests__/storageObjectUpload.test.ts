import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { abandoned, client } = vi.hoisted(() => ({
  // Records abandoned paths; the ledger itself is tested in abandonedUploads.test.ts.
  abandoned: vi.fn(async (_bucket: string, _path: string) => undefined),
  client: {
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'member-jwt' } } })) },
  },
}));
vi.mock('../abandonedUploads', () => ({
  abandonUpload: (bucket: string, path: string) => abandoned(bucket, path),
  sweepAbandonedUploads: async () => undefined,
}));

vi.mock('@kc/infrastructure-supabase', () => ({ getSupabaseClient: () => client }));
vi.mock('../../lib/supabasePublicConfig', () => ({
  getSupabasePublicEnv: () => ({ url: 'https://proj.supabase.co/', anonKey: 'anon-key' }),
}));
// Retries wait for real back-off delays; make them instant so the suite stays fast.
vi.mock('../uploadControl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../uploadControl')>();
  return {
    ...actual,
    retryAsync: (task: (attempt: number) => Promise<unknown>, opts: Parameters<typeof actual.retryAsync>[1]) =>
      actual.retryAsync(task, { ...opts, delay: async () => undefined }),
  };
});

import {
  isTransientUploadError,
  StorageHttpError,
  uploadErrorMessage,
  uploadStorageObject,
  uploadTimeoutMs,
} from '../storageObjectUpload';
import { UploadCancelledError, UploadTimeoutError } from '../uploadControl';

const ok = () => new Response('{"Key":"x"}', { status: 200 });
const fail = (status: number, message: string) =>
  new Response(JSON.stringify({ statusCode: String(status), error: 'Error', message }), { status });

/** One upload per attempt path; the fetch double sees every request. */
const input = (patch: Partial<Parameters<typeof uploadStorageObject>[0]> = {}) => ({
  bucket: 'post-images',
  pathForAttempt: (n: number) => `u/b/0${n === 1 ? '' : `-a${n}`}.jpg`,
  bytes: new Uint8Array(10),
  contentType: 'image/jpeg',
  cacheControl: 'public, max-age=31536000, immutable',
  ...patch,
});

/** A request the "server" holds open, settling only when the test says so (or the client aborts). */
function heldRequest() {
  let release!: (res: Response) => void;
  let signal!: AbortSignal;
  const fetchImpl = (_url: string, init: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      signal = init.signal as AbortSignal;
      release = resolve;
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
  return { fetchImpl, release: (res: Response) => release(res), signal: () => signal };
}

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});
afterEach(() => {
  fetchSpy.mockRestore();
  vi.useRealTimers();
});

describe('uploadTimeoutMs', () => {
  it('grows with the payload: a fixed base plus time at the slowest accepted throughput', () => {
    expect(uploadTimeoutMs(0)).toBe(20_000);
    expect(uploadTimeoutMs(25 * 1024)).toBe(21_000);
  });
});

describe('error classification', () => {
  it('treats network errors, timeouts, 408, 429 and 5xx as transient; other answers as final', () => {
    expect(isTransientUploadError(new TypeError('Network request failed'))).toBe(true);
    expect(isTransientUploadError(new UploadTimeoutError('x', 1))).toBe(true);
    expect(isTransientUploadError(new StorageHttpError(503, 'busy'))).toBe(true);
    expect(isTransientUploadError(new StorageHttpError(429, 'slow down'))).toBe(true);
    expect(isTransientUploadError(new StorageHttpError(403, 'rls'))).toBe(false);
    expect(isTransientUploadError(new StorageHttpError(409, 'exists'))).toBe(false);
    expect(isTransientUploadError(new UploadCancelledError())).toBe(false);
    expect(uploadErrorMessage(new StorageHttpError(413, 'too large'))).toBe('too large');
    expect(uploadErrorMessage('plain')).toBe('plain');
  });
});

describe('uploadStorageObject', () => {
  it('POSTs the bytes to the object endpoint as the member, without upsert, and returns the stored path', async () => {
    fetchSpy.mockResolvedValue(ok());
    await expect(uploadStorageObject(input())).resolves.toBe('u/b/0.jpg');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://proj.supabase.co/storage/v1/object/post-images/u/b/0.jpg');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      authorization: 'Bearer member-jwt',
      apikey: 'anon-key',
      'content-type': 'image/jpeg',
      // Sent verbatim: storage-js prefixed `max-age=` to this value, producing a malformed header.
      'cache-control': 'public, max-age=31536000, immutable',
      'x-upsert': 'false',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('a slow write that finishes AFTER the timeout: the request is aborted, the retry uses a NEW path, the old path is abandoned', async () => {
    vi.useFakeTimers();
    const first = heldRequest();
    fetchSpy.mockImplementationOnce(first.fetchImpl as typeof fetch).mockResolvedValueOnce(ok());
    const done = uploadStorageObject(input({ timeoutMs: 1000 }));
    await vi.advanceTimersByTimeAsync(1000);
    await expect(done).resolves.toBe('u/b/0-a2.jpg');
    // The first request was really cancelled at the transport, not merely ignored.
    expect(first.signal().aborted).toBe(true);
    expect((fetchSpy.mock.calls[1] as [string])[0]).toBe('https://proj.supabase.co/storage/v1/object/post-images/u/b/0-a2.jpg');
    // The first path is never referenced; it goes on the abandoned ledger in case it landed anyway.
    expect(abandoned).toHaveBeenCalledWith('post-images', 'u/b/0.jpg');
    // The server finishing the first write late changes nothing: the caller already holds path 2.
    first.release(ok());
    await vi.runAllTimersAsync();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('cancel aborts the in-flight request and abandons its path', async () => {
    const controller = new AbortController();
    const held = heldRequest();
    fetchSpy.mockImplementationOnce(held.fetchImpl as typeof fetch);
    const done = uploadStorageObject(input({ signal: controller.signal }));
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await expect(done).rejects.toBeInstanceOf(UploadCancelledError);
    expect(held.signal().aborted).toBe(true);
    expect(abandoned).toHaveBeenCalledWith('post-images', 'u/b/0.jpg');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx on a new path and never retries a final answer', async () => {
    fetchSpy.mockResolvedValueOnce(fail(503, 'busy')).mockResolvedValueOnce(ok());
    await expect(uploadStorageObject(input())).resolves.toBe('u/b/0-a2.jpg');
    // The server answered: nothing was stored, so nothing is abandoned.
    expect(abandoned).not.toHaveBeenCalled();
    fetchSpy.mockResolvedValueOnce(fail(403, 'new row violates row-level security policy'));
    await expect(uploadStorageObject(input())).rejects.toMatchObject({ status: 403 });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('abandons the path of a network failure (outcome unknown) and gives up after the attempts', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Network request failed'));
    await expect(uploadStorageObject(input({ attempts: 2 }))).rejects.toThrow('Network request failed');
    expect(abandoned.mock.calls).toEqual([['post-images', 'u/b/0.jpg'], ['post-images', 'u/b/0-a2.jpg']]);
  });

  it('does not start when already cancelled or signed out', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(uploadStorageObject(input({ signal: controller.signal }))).rejects.toBeInstanceOf(UploadCancelledError);
    client.auth.getSession.mockResolvedValueOnce({ data: { session: null } } as never);
    await expect(uploadStorageObject(input())).rejects.toMatchObject({ status: 401 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
