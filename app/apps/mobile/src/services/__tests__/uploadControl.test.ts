import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  abortableDelay,
  createOrderedCommitter,
  isUploadCancelled,
  mapSettledWithConcurrency,
  retryAsync,
  throwIfAborted,
  UploadCancelledError,
  UploadTimeoutError,
  withTimeout,
} from '../uploadControl';

/** A promise plus the handles to settle it from the test. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('withTimeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves and rejects with the wrapped promise when it settles in time', async () => {
    await expect(withTimeout(Promise.resolve(7), 100, 'x')).resolves.toBe(7);
    await expect(withTimeout(Promise.reject(new Error('boom')), 100, 'x')).rejects.toThrow('boom');
  });

  it('rejects with UploadTimeoutError when the promise never settles', async () => {
    const pending = withTimeout(new Promise(() => undefined), 1000, 'post-images/a.jpg');
    vi.advanceTimersByTime(1000);
    await expect(pending).rejects.toBeInstanceOf(UploadTimeoutError);
    await expect(pending).rejects.toThrow('post-images/a.jpg after 1000ms');
  });

  it('rejects with UploadCancelledError on abort, immediately or before starting', async () => {
    const controller = new AbortController();
    const pending = withTimeout(new Promise(() => undefined), 60_000, 'x', controller.signal);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(UploadCancelledError);
    await expect(withTimeout(Promise.resolve(1), 10, 'x', controller.signal)).rejects.toBeInstanceOf(UploadCancelledError);
  });

  it('ignores a late settle after the timeout fired', async () => {
    const d = deferred<number>();
    const pending = withTimeout(d.promise, 10, 'x');
    vi.advanceTimersByTime(10);
    d.resolve(1);
    await expect(pending).rejects.toBeInstanceOf(UploadTimeoutError);
  });
});

describe('abortableDelay / throwIfAborted', () => {
  it('waits, and is cut short by an abort', async () => {
    await expect(abortableDelay(1)).resolves.toBeUndefined();
    const controller = new AbortController();
    const waiting = abortableDelay(60_000, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(UploadCancelledError);
    await expect(abortableDelay(1, controller.signal)).rejects.toBeInstanceOf(UploadCancelledError);
    expect(() => throwIfAborted(controller.signal)).toThrow(UploadCancelledError);
    expect(() => throwIfAborted(undefined)).not.toThrow();
    expect(isUploadCancelled(new UploadCancelledError())).toBe(true);
    expect(isUploadCancelled(new Error('x'))).toBe(false);
  });
});

describe('retryAsync', () => {
  const delay = vi.fn(async () => undefined);
  beforeEach(() => {
    delay.mockClear();
  });

  it('retries a retryable failure with doubling back-off, then succeeds', async () => {
    const task = vi.fn().mockRejectedValueOnce(new Error('net')).mockRejectedValueOnce(new Error('net')).mockResolvedValue('ok');
    await expect(retryAsync(task, { attempts: 3, baseDelayMs: 100, isRetryable: () => true, delay })).resolves.toBe('ok');
    expect(task.mock.calls.map((c) => c[0])).toEqual([1, 2, 3]);
    expect(delay.mock.calls.map((c) => (c as unknown[])[0])).toEqual([100, 200]);
  });

  it('stops at the first non-retryable failure and after the last attempt', async () => {
    const final = vi.fn().mockRejectedValue(new Error('403'));
    await expect(retryAsync(final, { attempts: 3, baseDelayMs: 1, isRetryable: () => false, delay })).rejects.toThrow('403');
    expect(final).toHaveBeenCalledTimes(1);
    const flaky = vi.fn().mockRejectedValue(new Error('net'));
    await expect(retryAsync(flaky, { attempts: 2, baseDelayMs: 1, isRetryable: () => true, delay })).rejects.toThrow('net');
    expect(flaky).toHaveBeenCalledTimes(2);
  });

  it('never retries a cancellation and never starts once aborted', async () => {
    const cancelled = vi.fn().mockRejectedValue(new UploadCancelledError());
    await expect(retryAsync(cancelled, { attempts: 3, baseDelayMs: 1, isRetryable: () => true, delay })).rejects.toBeInstanceOf(UploadCancelledError);
    expect(cancelled).toHaveBeenCalledTimes(1);
    const controller = new AbortController();
    controller.abort();
    const task = vi.fn();
    await expect(retryAsync(task, { attempts: 3, baseDelayMs: 1, isRetryable: () => true, signal: controller.signal, delay })).rejects.toBeInstanceOf(UploadCancelledError);
    expect(task).not.toHaveBeenCalled();
  });
});

describe('mapSettledWithConcurrency', () => {
  it('never runs more than `limit` workers at once and keeps the input order', async () => {
    let running = 0;
    let peak = 0;
    const gates = [deferred<void>(), deferred<void>(), deferred<void>(), deferred<void>()];
    const worker = async (n: number, i: number) => {
      running += 1;
      peak = Math.max(peak, running);
      await gates[i]!.promise;
      running -= 1;
      if (n === 3) throw new Error('bad');
      return n * 10;
    };
    const done = mapSettledWithConcurrency([1, 2, 3, 4], 2, worker);
    // Release out of order: the result order must still follow the input.
    gates[1]!.resolve();
    gates[0]!.resolve();
    gates[3]!.resolve();
    gates[2]!.resolve();
    const results = await done;
    expect(peak).toBe(2);
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : (r.reason as Error).message))).toEqual([10, 20, 'bad', 40]);
  });

  it('settles items not yet started as cancelled once aborted, and reports each settle', async () => {
    const controller = new AbortController();
    const onSettled = vi.fn();
    const worker = vi.fn(async (n: number) => {
      controller.abort();
      return n;
    });
    const results = await mapSettledWithConcurrency([1, 2, 3], 1, worker, { signal: controller.signal, onSettled });
    expect(worker).toHaveBeenCalledTimes(1);
    expect(results[0]).toEqual({ status: 'fulfilled', value: 1 });
    expect(results.slice(1).every((r) => r.status === 'rejected' && isUploadCancelled(r.reason))).toBe(true);
    expect(onSettled.mock.calls.map((c) => c[0])).toEqual([0, 1, 2]);
  });

  it('handles an empty list', async () => {
    await expect(mapSettledWithConcurrency([], 3, async () => 1)).resolves.toEqual([]);
  });
});

describe('createOrderedCommitter', () => {
  it('releases values in input order and counts failures as released slots', () => {
    const commit = vi.fn();
    const settle = createOrderedCommitter<string>(4, commit);
    settle(1, { status: 'fulfilled', value: 'b' });
    expect(commit).not.toHaveBeenCalled();
    settle(0, { status: 'fulfilled', value: 'a' });
    expect(commit).toHaveBeenLastCalledWith(['a', 'b'], 2);
    settle(3, { status: 'fulfilled', value: 'd' });
    settle(2, { status: 'rejected', reason: new Error('x') });
    expect(commit).toHaveBeenLastCalledWith(['d'], 2);
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it('reports a released failure with no values so the pending count still shrinks', () => {
    const commit = vi.fn();
    createOrderedCommitter<string>(1, commit)(0, { status: 'rejected', reason: 'x' });
    expect(commit).toHaveBeenCalledWith([], 1);
  });
});
