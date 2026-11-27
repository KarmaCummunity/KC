import { beforeEach, describe, expect, it, vi } from 'vitest';
import { performFullSignOut } from '../performFullSignOut';

const serverSignOut = vi.hoisted(() => vi.fn());
vi.mock('../authComposition', () => ({
  getSignOutUseCase: () => ({ execute: serverSignOut }),
}));

const marks = vi.hoisted(() => ({ startMark: vi.fn(), finishMark: vi.fn() }));
vi.mock('../../lib/observability/perfMarks', () => marks);

const signOutDeps = () => ({
  deviceRepo: {} as never,
  queryClient: { clear: vi.fn() } as never,
  signOutLocal: vi.fn(),
});

vi.mock('../../store/persistedStoresReset', () => ({
  clearAllPersistedStores: vi.fn().mockResolvedValue(undefined),
}));

const deactivate = vi.hoisted(() => vi.fn());
vi.mock('../../lib/notifications/register', () => ({
  deactivateCurrentDevice: deactivate,
}));

describe('performFullSignOut', () => {
  beforeEach(() => {
    deactivate.mockResolvedValue(undefined);
    serverSignOut.mockReset().mockResolvedValue(undefined);
    marks.startMark.mockReset();
    marks.finishMark.mockReset();
  });

  // #2579: field traces must show which sign-out phase is slow, and whether the push cap fired.
  it('times each sign-out phase and tags how it ended', async () => {
    await performFullSignOut(signOutDeps());
    expect(marks.startMark.mock.calls.map((c) => c[0])).toEqual([
      'auth.sign_out',
      'auth.sign_out.device_deactivation',
      'auth.sign_out.server_revoke',
    ]);
    expect(marks.finishMark).toHaveBeenCalledWith('auth.sign_out.device_deactivation', { outcome: 'settled' });
    expect(marks.finishMark).toHaveBeenCalledWith('auth.sign_out.server_revoke', { outcome: 'ok' });
    expect(marks.finishMark).toHaveBeenCalledWith('auth.sign_out', { outcome: 'ok' });
  });

  it('tags a push cleanup that hit the cap as timed_out', async () => {
    vi.useFakeTimers();
    deactivate.mockReturnValue(new Promise(() => undefined));
    const done = performFullSignOut(signOutDeps());
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    expect(marks.finishMark).toHaveBeenCalledWith('auth.sign_out.device_deactivation', { outcome: 'timed_out' });
    vi.useRealTimers();
  });

  it('tags a failed server sign-out as error and still reports the total', async () => {
    serverSignOut.mockRejectedValue(new Error('offline'));
    await expect(performFullSignOut(signOutDeps())).rejects.toThrow('offline');
    expect(marks.finishMark).toHaveBeenCalledWith('auth.sign_out.server_revoke', { outcome: 'error' });
    expect(marks.finishMark).toHaveBeenCalledWith('auth.sign_out', { outcome: 'error' });
  });

  it('deactivates device, signs out, clears stores, and clears query cache', async () => {
    const signOutLocal = vi.fn();
    const clear = vi.fn();
    const deviceRepo = {} as never;

    await performFullSignOut({
      deviceRepo,
      queryClient: { clear } as never,
      signOutLocal,
    });

    expect(clear).toHaveBeenCalled();
    expect(signOutLocal).toHaveBeenCalled();
  });

  it('still signs out locally when push deactivation hangs (regression: stuck sign-out)', async () => {
    vi.useFakeTimers();
    deactivate.mockReturnValue(new Promise(() => undefined));
    const signOutLocal = vi.fn();
    const done = performFullSignOut({
      deviceRepo: {} as never,
      queryClient: { clear: vi.fn() } as never,
      signOutLocal,
    });
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    expect(signOutLocal).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
