// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import type { UploadedAsset } from '../../services/imageUpload';

const { pickPostImages, uploadPostImageBatch } = vi.hoisted(() => ({
  pickPostImages: vi.fn(),
  uploadPostImageBatch: vi.fn(),
}));
vi.mock('../../services/imageUpload', () => ({ pickPostImages, uploadPostImageBatch }));

import { usePostImageUploads } from '../usePostImageUploads';
import { UploadCancelledError } from '../../services/uploadControl';

const asset = (n: number): UploadedAsset => ({ path: `u/b/${n}.jpg`, mimeType: 'image/jpeg', sizeBytes: 1, previewUri: `file://${n}` });
const picked = (n: number) => ({ uri: `file://${n}`, width: 10, height: 10, fileSize: null });

/** A promise plus the handle to resolve it from the test. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function setup(ownerId: string | null = 'u1') {
  const onMissingOwner = vi.fn();
  const onFailures = vi.fn();
  const hook = renderHook(() => {
    const [uploads, setUploads] = useState<UploadedAsset[]>([]);
    const api = usePostImageUploads({ ownerId, galleryCount: uploads.length, setUploads, onMissingOwner, onFailures });
    return { ...api, uploads };
  });
  return { ...hook, onMissingOwner, onFailures };
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('usePostImageUploads', () => {
  it('asks to sign in again without an owner, and does nothing on an empty pick', async () => {
    const missing = setup(null);
    await act(async () => { await missing.result.current.pickAndUpload(); });
    expect(missing.onMissingOwner).toHaveBeenCalledTimes(1);
    expect(pickPostImages).not.toHaveBeenCalled();

    pickPostImages.mockResolvedValue({ status: 'ok', value: [] });
    const empty = setup();
    await act(async () => { await empty.result.current.pickAndUpload(); });
    expect(uploadPostImageBatch).not.toHaveBeenCalled();
    expect(empty.result.current.uploadingCount).toBe(0);
  });

  it('adds photos in pick order as they settle and shrinks the pending tiles with them', async () => {
    pickPostImages.mockResolvedValue({ status: 'ok', value: [picked(0), picked(1)] });
    const gate = deferred<void>();
    uploadPostImageBatch.mockImplementation(async (_p, _owner, opts) => {
      // The second photo finishes first: it must wait for the first one to keep the cover.
      opts.onSettled(1, { status: 'fulfilled', value: asset(1) });
      await gate.promise;
      opts.onSettled(0, { status: 'fulfilled', value: asset(0) });
      return [{ status: 'fulfilled', value: asset(0) }, { status: 'fulfilled', value: asset(1) }];
    });
    const { result, onFailures } = setup();
    let done!: Promise<void>;
    act(() => { done = result.current.pickAndUpload(); });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.uploadingCount).toBe(2);
    expect(result.current.uploads).toEqual([]);
    await act(async () => { gate.resolve(); await done; });
    expect(result.current.uploads.map((u) => u.path)).toEqual(['u/b/0.jpg', 'u/b/1.jpg']);
    expect(result.current.uploadingCount).toBe(0);
    expect(onFailures).not.toHaveBeenCalled();
    expect(pickPostImages).toHaveBeenCalledWith(0);
  });

  it('keeps the stored photos and reports the failures, ignoring cancellations', async () => {
    pickPostImages.mockResolvedValue({ status: 'ok', value: [picked(0), picked(1), picked(2)] });
    const boom = new Error('upload[1]: quota');
    const settled: PromiseSettledResult<UploadedAsset>[] = [
      { status: 'fulfilled', value: asset(0) },
      { status: 'rejected', reason: boom },
      { status: 'rejected', reason: new UploadCancelledError() },
    ];
    uploadPostImageBatch.mockImplementation(async (_p, _owner, opts) => {
      settled.forEach((r, i) => opts.onSettled(i, r));
      return settled;
    });
    const { result, onFailures } = setup();
    await act(async () => { await result.current.pickAndUpload(); });
    expect(result.current.uploads.map((u) => u.path)).toEqual(['u/b/0.jpg']);
    expect(result.current.uploadingCount).toBe(0);
    expect(onFailures).toHaveBeenCalledWith({ ok: 1, total: 2, firstError: boom });
  });

  it('aborts in-flight uploads on cancel and when the screen unmounts', async () => {
    pickPostImages.mockResolvedValue({ status: 'ok', value: [picked(0)] });
    const signals: AbortSignal[] = [];
    uploadPostImageBatch.mockImplementation((_p, _owner, opts) => {
      signals.push(opts.signal);
      return new Promise(() => undefined);
    });
    const { result, unmount } = setup();
    act(() => { void result.current.pickAndUpload(); });
    await act(async () => { await Promise.resolve(); });
    act(() => result.current.cancelUploads());
    expect(signals[0]?.aborted).toBe(true);
    act(() => { void result.current.pickAndUpload(); });
    await act(async () => { await Promise.resolve(); });
    unmount();
    expect(signals[1]?.aborted).toBe(true);
  });

  it('surfaces a blocked photo-library permission without uploading', async () => {
    pickPostImages.mockResolvedValue({ status: 'blocked', kind: 'mediaLibrary' });
    const { result } = setup();
    await act(async () => { await result.current.pickAndUpload(); });
    expect(result.current.permissionBlocked).toBe('mediaLibrary');
    expect(uploadPostImageBatch).not.toHaveBeenCalled();
  });
});
