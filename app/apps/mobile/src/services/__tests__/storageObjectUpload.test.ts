import { beforeEach, describe, expect, it, vi } from 'vitest';

const { bucket, client } = vi.hoisted(() => {
  const bucket = { upload: vi.fn() };
  return { bucket, client: { storage: { from: vi.fn(() => bucket) } } };
});

vi.mock('@kc/infrastructure-supabase', () => ({ getSupabaseClient: () => client }));
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
  isAlreadyExistsError,
  isTransientUploadError,
  uploadErrorMessage,
  uploadStorageObject,
  uploadTimeoutMs,
} from '../storageObjectUpload';
import { UploadCancelledError, UploadTimeoutError } from '../uploadControl';

const input = {
  bucket: 'post-images',
  path: 'u/b/0.jpg',
  bytes: new Uint8Array(10),
  contentType: 'image/jpeg',
  cacheControl: 'public, max-age=31536000, immutable',
};

beforeEach(() => vi.clearAllMocks());

describe('uploadTimeoutMs', () => {
  it('grows with the payload: a fixed base plus time at the slowest accepted throughput', () => {
    expect(uploadTimeoutMs(0)).toBe(20_000);
    expect(uploadTimeoutMs(25 * 1024)).toBe(21_000);
    expect(uploadTimeoutMs(5 * 1024 * 1024)).toBe(20_000 + 204_800);
  });
});

describe('error classification', () => {
  it('treats network errors, timeouts, 408, 429 and 5xx as transient; other 4xx as final', () => {
    expect(isTransientUploadError({ message: 'Network request failed' })).toBe(true);
    expect(isTransientUploadError(new UploadTimeoutError('x', 1))).toBe(true);
    expect(isTransientUploadError({ status: 503 })).toBe(true);
    expect(isTransientUploadError({ statusCode: '429' })).toBe(true);
    expect(isTransientUploadError({ status: 408 })).toBe(true);
    expect(isTransientUploadError({ status: 403, message: 'new row violates row-level security policy' })).toBe(false);
    expect(isTransientUploadError({ status: 413 })).toBe(false);
    expect(isTransientUploadError(null)).toBe(false);
  });

  it('recognizes an object that already exists by status or message', () => {
    expect(isAlreadyExistsError({ status: 409 })).toBe(true);
    expect(isAlreadyExistsError({ statusCode: '409' })).toBe(true);
    expect(isAlreadyExistsError({ status: 400, message: 'The resource already exists' })).toBe(true);
    expect(isAlreadyExistsError({ status: 400, message: 'invalid' })).toBe(false);
    expect(isAlreadyExistsError('x')).toBe(false);
  });

  it('formats a reason from an error object or any value', () => {
    expect(uploadErrorMessage({ message: 'quota' })).toBe('quota');
    expect(uploadErrorMessage('plain')).toBe('plain');
  });
});

describe('uploadStorageObject', () => {
  it('uploads once with the given type, cache headers and no upsert by default', async () => {
    bucket.upload.mockResolvedValue({ error: null });
    await uploadStorageObject(input);
    expect(client.storage.from).toHaveBeenCalledWith('post-images');
    expect(bucket.upload).toHaveBeenCalledWith('u/b/0.jpg', input.bytes, {
      contentType: 'image/jpeg',
      upsert: false,
      cacheControl: 'public, max-age=31536000, immutable',
    });
  });

  it('retries a transient failure and succeeds', async () => {
    bucket.upload.mockResolvedValueOnce({ error: { status: 503, message: 'busy' } }).mockResolvedValueOnce({ error: null });
    await uploadStorageObject(input);
    expect(bucket.upload).toHaveBeenCalledTimes(2);
  });

  it('accepts "already exists" on a retry: the timed-out first attempt did store the object', async () => {
    bucket.upload
      .mockResolvedValueOnce({ error: { message: 'Network request failed' } })
      .mockResolvedValueOnce({ error: { status: 409, message: 'The resource already exists' } });
    await expect(uploadStorageObject(input)).resolves.toBeUndefined();
  });

  it('reports "already exists" on the first attempt, and never retries a final error', async () => {
    bucket.upload.mockResolvedValueOnce({ error: { status: 409, message: 'The resource already exists' } });
    await expect(uploadStorageObject(input)).rejects.toMatchObject({ status: 409 });
    bucket.upload.mockResolvedValueOnce({ error: { status: 403, message: 'rls' } });
    await expect(uploadStorageObject(input)).rejects.toMatchObject({ message: 'rls' });
    expect(bucket.upload).toHaveBeenCalledTimes(2);
  });

  it('gives up after the configured attempts', async () => {
    bucket.upload.mockResolvedValue({ error: { status: 500, message: 'down' } });
    await expect(uploadStorageObject({ ...input, attempts: 2 })).rejects.toMatchObject({ message: 'down' });
    expect(bucket.upload).toHaveBeenCalledTimes(2);
  });

  it('does not start when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(uploadStorageObject({ ...input, signal: controller.signal })).rejects.toBeInstanceOf(UploadCancelledError);
    expect(bucket.upload).not.toHaveBeenCalled();
  });
});
