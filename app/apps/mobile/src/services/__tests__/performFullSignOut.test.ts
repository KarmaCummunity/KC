import { beforeEach, describe, expect, it, vi } from 'vitest';
import { performFullSignOut } from '../performFullSignOut';

vi.mock('../authComposition', () => ({
  getSignOutUseCase: () => ({
    execute: vi.fn().mockResolvedValue(undefined),
  }),
}));

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
