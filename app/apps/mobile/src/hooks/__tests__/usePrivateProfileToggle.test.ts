// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findById, execute, invalidateQueries, t, profile } = vi.hoisted(() => ({
  findById: vi.fn(), execute: vi.fn(), invalidateQueries: vi.fn(), t: vi.fn((key: string) => key),
  profile: { current: undefined as { privacyMode: string } | undefined },
}));
vi.mock('../../services/userComposition', () => ({ getUserRepo: () => ({ findById }) }));
vi.mock('../../services/followComposition', () => ({ getUpdatePrivacyModeUseCase: () => ({ execute }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries }),
  useQuery: ({ queryKey, queryFn, enabled }: { queryKey: unknown[]; queryFn: () => Promise<unknown>; enabled: boolean }) => {
    if (enabled && !profile.current) void queryFn;
    return { data: profile.current, queryKey };
  },
}));
import { usePrivateProfileToggle } from '../usePrivateProfileToggle';

beforeEach(() => {
  findById.mockReset(); execute.mockReset().mockResolvedValue(undefined); invalidateQueries.mockReset();
  t.mockClear();
  profile.current = undefined;
});

describe('usePrivateProfileToggle', () => {
  it('disables toggling without loaded user data and ignores a toggle request', () => {
    const { result } = renderHook(() => usePrivateProfileToggle(undefined));
    expect(result.current.isPrivate).toBe(false);
    expect(result.current.canToggle).toBe(false);
    act(() => result.current.onToggle(true));
    expect(result.current.confirmModal).toBeNull();
    expect(findById).not.toHaveBeenCalled();
  });

  it('offers a private confirmation and commits with invalidation on success', async () => {
    profile.current = { privacyMode: 'Public' };
    const { result } = renderHook(() => usePrivateProfileToggle('u1'));
    expect(result.current.canToggle).toBe(true);
    expect(result.current.isPrivate).toBe(false);
    act(() => result.current.onToggle(true));
    expect(result.current.confirmModal).toMatchObject({
      visible: true, title: 'settings.privacyScreen.confirmPrivateTitle',
      message: 'settings.privacyScreen.confirmPrivateMessage', confirmLabel: 'settings.privacyScreen.confirmPrivateCta', isBusy: false,
    });
    await act(async () => result.current.confirmModal?.onConfirm());
    expect(execute).toHaveBeenCalledWith({ userId: 'u1', mode: 'Private' });
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, { queryKey: ['user-profile', 'u1'] });
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, { queryKey: ['pending-requests-count', 'u1'] });
    expect(result.current.confirmModal).toBeNull();
  });

  it('dismisses a failed confirmation and resets its busy state', async () => {
    execute.mockRejectedValue(new Error('offline'));
    profile.current = { privacyMode: 'Private' };
    const { result } = renderHook(() => usePrivateProfileToggle('u1'));
    act(() => result.current.onToggle(false));
    expect(result.current.confirmModal?.title).toBe('settings.privacyScreen.confirmPublicTitle');
    await act(async () => result.current.confirmModal?.onConfirm());
    expect(execute).toHaveBeenCalledWith({ userId: 'u1', mode: 'Public' });
    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(result.current.confirmModal).toBeNull();
  });
});
