// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ toast: vi.fn(), share: vi.fn(), hapticLight: vi.fn(), hapticSuccess: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../store/feedSessionStore', () => ({
  useFeedSessionStore: (sel: (s: { showEphemeralToast: typeof mocks.toast }) => unknown) => sel({ showEphemeralToast: mocks.toast }),
}));
vi.mock('../../lib/sharePost', () => ({ shareLink: mocks.share }));
vi.mock('../../lib/haptics', () => ({ hapticLightTap: mocks.hapticLight, hapticSuccess: mocks.hapticSuccess }));

import { useProfileShare } from '../useProfileShare';

const profile = { shareHandle: 'dana.k', displayName: 'Dana' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.share.mockResolvedValue({ kind: 'shared' });
});

describe('useProfileShare', () => {
  it('shares the /user/<handle> link with the composed message', async () => {
    const { result } = renderHook(() => useProfileShare(profile));
    expect(result.current.canShare).toBe(true);
    await act(async () => { await result.current.share(); });
    expect(mocks.share).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://karma-community-kc.com/user/dana.k', imageKey: 'profile-dana.k', message: expect.stringContaining('share.profile.headline') }),
    );
    expect(mocks.hapticSuccess).toHaveBeenCalledOnce();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('does nothing without a profile', async () => {
    const { result } = renderHook(() => useProfileShare(undefined));
    expect(result.current.canShare).toBe(false);
    await act(async () => { await result.current.share(); });
    expect(mocks.share).not.toHaveBeenCalled();
  });

  it('toasts on a copied link and on failures, including a thrown one', async () => {
    const { result } = renderHook(() => useProfileShare(profile));
    mocks.share.mockResolvedValueOnce({ kind: 'copied' });
    await act(async () => { await result.current.share(); });
    expect(mocks.toast).toHaveBeenCalledWith('share.copiedToast', 'success', 1800);
    mocks.share.mockResolvedValueOnce({ kind: 'failed', reason: 'x' });
    await act(async () => { await result.current.share(); });
    mocks.share.mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await act(async () => { await result.current.share(); });
    expect(mocks.toast).toHaveBeenCalledWith('share.failedToast', 'error', 2200);
    expect(mocks.toast).toHaveBeenCalledTimes(3);
    expect(result.current.busy).toBe(false);
  });
});
