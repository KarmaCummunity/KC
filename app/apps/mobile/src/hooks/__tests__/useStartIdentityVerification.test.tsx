// @vitest-environment jsdom
// FR-VERIFY-004 / FR-VERIFY-005 — starting the provider flow: consent is required, the provider
// page opens from the tap (web) or the in-app browser (native), a refused start shows its message,
// and coming back re-reads the status and the badge without setting the level.
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  openBrowserAsync: vi.fn(),
  platform: { OS: 'ios' as 'ios' | 'web' },
}));
vi.mock('react-native', () => ({ Platform: mocks.platform }));
vi.mock('expo-web-browser', () => ({ openBrowserAsync: mocks.openBrowserAsync }));
vi.mock('../../services/identityVerificationComposition', () => ({
  getStartIdentityVerificationUseCase: () => ({ execute: mocks.execute }),
  getIdentityVerificationStatusUseCase: () => ({ execute: vi.fn() }),
}));
vi.mock('../../store/authStore', () => {
  const state = { session: { userId: 'u1' } };
  const useAuthStore = (selector: (s: typeof state) => unknown) => selector(state);
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

import { IdentityVerificationError } from '@kc/domain';
import { useStartIdentityVerification, identityVerificationKeys } from '../useIdentityVerification';
import { userProfileKeys } from '../../lib/queryKeys';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const fakeTab = () => ({ closed: false, opener: {} as unknown, close: vi.fn(), location: { href: '' } });

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mocks.execute.mockReset();
  mocks.openBrowserAsync.mockReset().mockResolvedValue({ type: 'cancel' });
  mocks.platform.OS = 'ios';
});
afterEach(() => vi.restoreAllMocks());

describe('useStartIdentityVerification', () => {
  it('never starts without a ticked consent', () => {
    const open = vi.spyOn(window, 'open');
    const { result } = renderHook(() => useStartIdentityVerification(), { wrapper });
    act(() => result.current.start(false));
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.openBrowserAsync).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('native: records consent, opens the in-app browser, then re-reads status and badge', async () => {
    mocks.execute.mockResolvedValue({ hostedUrl: 'https://provider.test/s/1' });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useStartIdentityVerification(), { wrapper });
    act(() => result.current.start(true));
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith({ consentGiven: true });
    expect(mocks.openBrowserAsync).toHaveBeenCalledExactlyOnceWith('https://provider.test/s/1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: identityVerificationKeys.status('u1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: userProfileKeys.byId('u1') });
    expect(result.current.errorCode).toBeNull();
  });

  it('a refused start shows its code, opens nothing and still re-reads', async () => {
    mocks.execute.mockRejectedValue(new IdentityVerificationError('attempts_exhausted'));
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useStartIdentityVerification(), { wrapper });
    act(() => result.current.start(true));
    await waitFor(() => expect(result.current.errorCode).toBe('attempts_exhausted'));
    expect(mocks.openBrowserAsync).not.toHaveBeenCalled();
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
  });

  it('a provider or network failure shows the generic message', async () => {
    mocks.execute.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useStartIdentityVerification(), { wrapper });
    act(() => result.current.start(true));
    await waitFor(() => expect(result.current.errorCode).toBe('unavailable'));
  });

  it('native: failing to open the browser shows the generic message', async () => {
    mocks.execute.mockResolvedValue({ hostedUrl: 'https://provider.test/s/1' });
    mocks.openBrowserAsync.mockRejectedValue(new Error('no browser'));
    const { result } = renderHook(() => useStartIdentityVerification(), { wrapper });
    act(() => result.current.start(true));
    await waitFor(() => expect(result.current.errorCode).toBe('unavailable'));
  });

  describe('web', () => {
    beforeEach(() => { mocks.platform.OS = 'web'; });

    it('opens the tab inside the tap, before any network call, then points it at the provider page', async () => {
      const tab = fakeTab();
      const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
      mocks.execute.mockImplementation(async () => {
        expect(open).toHaveBeenCalledTimes(1); // already open while the session is still being created
        return { hostedUrl: 'https://provider.test/s/2' };
      });
      const { result } = renderHook(() => useStartIdentityVerification(), { wrapper });
      act(() => result.current.start(true));
      await waitFor(() => expect(tab.location.href).toBe('https://provider.test/s/2'));
      expect(open).toHaveBeenCalledExactlyOnceWith('', '_blank');
      expect(tab.opener).toBeNull();
      expect(result.current.errorCode).toBeNull();
    });

    it('closes the tab when the start is refused', async () => {
      const tab = fakeTab();
      vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
      mocks.execute.mockRejectedValue(new IdentityVerificationError('account_not_active'));
      const { result } = renderHook(() => useStartIdentityVerification(), { wrapper });
      act(() => result.current.start(true));
      await waitFor(() => expect(result.current.errorCode).toBe('account_not_active'));
      expect(tab.close).toHaveBeenCalledTimes(1);
      expect(tab.location.href).toBe('');
    });

    it('a blocked pop-up is a visible, specific message and creates no provider session', async () => {
      vi.spyOn(window, 'open').mockReturnValue(null);
      mocks.execute.mockResolvedValue({ hostedUrl: 'https://provider.test/s/3' });
      const { result } = renderHook(() => useStartIdentityVerification(), { wrapper });
      act(() => result.current.start(true));
      await waitFor(() => expect(result.current.errorCode).toBe('popup_blocked'));
      expect(mocks.execute).not.toHaveBeenCalled();
    });

    it('a tab already closed when the start runs creates no provider session either', async () => {
      const tab = { ...fakeTab(), closed: true };
      vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
      const { result } = renderHook(() => useStartIdentityVerification(), { wrapper });
      act(() => result.current.start(true));
      await waitFor(() => expect(result.current.errorCode).toBe('popup_blocked'));
      expect(mocks.execute).not.toHaveBeenCalled();
      expect(tab.location.href).toBe('');
    });

    it('a tab the member closes while the session is created is reported as blocked, never opened', async () => {
      const tab = fakeTab();
      vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
      mocks.execute.mockImplementation(async () => {
        tab.closed = true;
        return { hostedUrl: 'https://provider.test/s/4' };
      });
      const { result } = renderHook(() => useStartIdentityVerification(), { wrapper });
      act(() => result.current.start(true));
      await waitFor(() => expect(result.current.errorCode).toBe('popup_blocked'));
      expect(tab.location.href).toBe('');
    });
  });
});
