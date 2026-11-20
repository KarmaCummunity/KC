// Generic control flow for media uploads: cancellation, per-attempt timeouts, retries with
// back-off and bounded parallelism. Pure (no React, no Supabase), so every upload pipeline
// (post photos, listing photos, chat media, avatars) shares one tested implementation and a
// stuck network request can never leave a screen spinning forever.

/** Thrown when the caller aborted the work (screen closed, user tapped cancel). */
export class UploadCancelledError extends Error {
  constructor() {
    super('upload_cancelled');
    this.name = 'UploadCancelledError';
  }
}

/** Thrown when one attempt did not settle within its time budget. */
export class UploadTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`upload_timeout: ${label} after ${ms}ms`);
    this.name = 'UploadTimeoutError';
  }
}

export function isUploadCancelled(err: unknown): boolean {
  return err instanceof UploadCancelledError;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new UploadCancelledError();
}

/**
 * Settles with `promise`, or rejects with `UploadTimeoutError` after `ms`, or with
 * `UploadCancelledError` as soon as `signal` aborts — whichever comes first.
 * The underlying request is not interrupted (storage-js exposes no abort hook); the caller
 * is released, and a late success is harmless because every object path is unique.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadCancelledError());
      return;
    }
    const onAbort = () => finish(() => reject(new UploadCancelledError()));
    const timer = setTimeout(() => finish(() => reject(new UploadTimeoutError(label, ms))), ms);
    let settled = false;
    function finish(settle: () => void) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      settle();
    }
    signal?.addEventListener('abort', onAbort);
    promise.then(
      (value) => finish(() => resolve(value)),
      (err: unknown) => finish(() => reject(err)),
    );
  });
}

/** Resolves after `ms`, or rejects early with `UploadCancelledError` when `signal` aborts. */
export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadCancelledError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new UploadCancelledError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface RetryOptions {
  /** Total attempts, including the first one (≥ 1). */
  readonly attempts: number;
  /** Delay before the second attempt; doubles for each further attempt. */
  readonly baseDelayMs: number;
  /** Whether a failure may be retried. Cancellation is never retried. */
  readonly isRetryable: (err: unknown) => boolean;
  readonly signal?: AbortSignal;
  /** Injectable for tests. */
  readonly delay?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** Runs `task(attempt)` (attempt is 1-based) until it succeeds or a non-retryable error. */
export async function retryAsync<T>(task: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  const wait = opts.delay ?? abortableDelay;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= Math.max(1, opts.attempts); attempt += 1) {
    throwIfAborted(opts.signal);
    try {
      return await task(attempt);
    } catch (err) {
      lastError = err;
      const canRetry = attempt < opts.attempts && !isUploadCancelled(err) && opts.isRetryable(err);
      if (!canRetry) throw err;
      await wait(opts.baseDelayMs * 2 ** (attempt - 1), opts.signal);
    }
  }
  throw lastError;
}

/**
 * Maps `items` through `worker` with at most `limit` running at once, preserving input order
 * in the result. Every item settles: a failure never stops its siblings. Once `signal` aborts,
 * items not yet started settle as `UploadCancelledError` without running.
 * `onSettled` fires as each item finishes (for progress UI).
 */
export async function mapSettledWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  opts: { signal?: AbortSignal; onSettled?: (index: number, result: PromiseSettledResult<R>) => void } = {},
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const runLane = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await settleOne(items[index] as T, index);
      opts.onSettled?.(index, results[index]);
    }
  };
  const settleOne = async (item: T, index: number): Promise<PromiseSettledResult<R>> => {
    try {
      throwIfAborted(opts.signal);
      return { status: 'fulfilled', value: await worker(item, index) };
    } catch (reason) {
      return { status: 'rejected', reason };
    }
  };
  const lanes = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: lanes }, runLane));
  return results;
}

/**
 * Releases settled results strictly in input order: item `i` is handed to `commit` only once
 * items `0..i-1` were handed over too. Lets a gallery fill in progressively while keeping the
 * order the member picked (the first pick stays the cover). `commit` receives the successful
 * values released now and how many items (successes and failures) they account for, so a
 * pending-tile counter shrinks exactly as the gallery grows.
 */
export function createOrderedCommitter<R>(total: number, commit: (values: R[], released: number) => void) {
  const slots: (PromiseSettledResult<R> | undefined)[] = new Array(total);
  let cursor = 0;
  return (index: number, result: PromiseSettledResult<R>) => {
    slots[index] = result;
    const values: R[] = [];
    const start = cursor;
    while (cursor < total && slots[cursor] !== undefined) {
      const slot = slots[cursor] as PromiseSettledResult<R>;
      if (slot.status === 'fulfilled') values.push(slot.value);
      cursor += 1;
    }
    if (cursor > start) commit(values, cursor - start);
  };
}
