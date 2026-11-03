// TD-127 (2) / FR-AUTH-013 — cold-start session restore must not let a late
// restore failure (e.g. a 401 while refreshing) overwrite a live session the
// auth subscription already delivered (1-frame flash to the sign-in screen).
import { describe, expect, it, vi } from 'vitest';
import { startColdStartSession } from '../coldStartSession';

type S = { userId: string } | null;

function harness() {
  let emit: (s: S) => void = () => {};
  let resolveRestore: (s: S) => void = () => {};
  let rejectRestore: (e: unknown) => void = () => {};
  const setSession = vi.fn<(s: S) => void>();
  const unsubscribe = vi.fn();
  const dispose = startColdStartSession<NonNullable<S>>({
    restore: () =>
      new Promise<S>((res, rej) => {
        resolveRestore = res;
        rejectRestore = rej;
      }),
    subscribe: (listener) => {
      emit = listener;
      return unsubscribe;
    },
    devFallback: async (s) => s,
    setSession,
  });
  return { emit: (s: S) => emit(s), resolveRestore, rejectRestore: (e: unknown) => rejectRestore(e), setSession, unsubscribe, dispose };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('startColdStartSession', () => {
  it('keeps a live session when restore fails afterwards', async () => {
    const h = harness();
    h.emit({ userId: 'u1' });
    h.rejectRestore(new Error('401'));
    await flush();
    expect(h.setSession).not.toHaveBeenCalledWith(null);
    expect(h.setSession).toHaveBeenLastCalledWith({ userId: 'u1' });
  });

  it('defers a live null until restore settles, then follows live changes', async () => {
    const h = harness();
    h.emit(null);
    expect(h.setSession).not.toHaveBeenCalled();
    h.resolveRestore({ userId: 'u1' });
    await flush();
    expect(h.setSession).toHaveBeenLastCalledWith({ userId: 'u1' });
    h.emit(null); // a real sign-out after boot
    expect(h.setSession).toHaveBeenLastCalledWith(null);
  });

  it('applies the restored session, and nothing after dispose', async () => {
    const h = harness();
    h.resolveRestore({ userId: 'u2' });
    await flush();
    expect(h.setSession).toHaveBeenLastCalledWith({ userId: 'u2' });
    h.dispose();
    h.emit({ userId: 'u3' });
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
    expect(h.setSession).toHaveBeenCalledTimes(1);
  });
});
