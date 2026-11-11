// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteExecute: vi.fn(), resetOnboarding: vi.fn(), signOut: vi.fn(), setLocal: vi.fn(), setSkipped: vi.fn(),
  replace: vi.fn(), t: vi.fn((key: string, options?: { msg?: string }) => options ? `${key}:${options.msg}` : key),
  alert: vi.fn(), confirm: vi.fn(), platform: { os: 'web' as string },
}));
vi.mock('../../services/userComposition', () => ({
  getDeleteAccountUseCase: () => ({ execute: mocks.deleteExecute }),
  resetOnboardingForDev: mocks.resetOnboarding,
}));
vi.mock('../../services/performFullSignOut', () => ({ performFullSignOut: mocks.signOut }));
vi.mock('../../store/authStore', () => ({
  useAuthStore: Object.assign(
      (selector: (state: { session: { userId: string } | null; setOnboardingState: typeof mocks.setLocal; signOut: typeof mocks.signOut }) => unknown) =>
        selector({ session: { userId: 'u1' }, setOnboardingState: mocks.setLocal, signOut: mocks.signOut }),
      {
        getState: () => ({ setBasicInfoSkipped: mocks.setSkipped }),
      },
  ),
}));
vi.mock('expo-router', () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ clear: vi.fn() }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  return {
    ...actual,
    Alert: { ...actual.Alert, alert: (...args: unknown[]) => mocks.alert(...args) },
    Platform: { ...actual.Platform, get OS() { return mocks.platform.os; } },
  };
});
vi.mock('../../lib/container', () => ({ container: { deviceRepo: { deactivate: vi.fn() } } }));
import { useSettingsAccountActions } from '../useSettingsAccountActions';

beforeEach(() => {
  vi.useRealTimers(); vi.clearAllMocks(); mocks.platform.os = 'web';
  vi.stubGlobal('confirm', mocks.confirm);
  vi.stubGlobal('alert', mocks.alert);
  mocks.deleteExecute.mockResolvedValue(undefined); mocks.resetOnboarding.mockResolvedValue(undefined);
  mocks.signOut.mockResolvedValue(undefined); mocks.confirm.mockReturnValue(true);
});
afterEach(() => vi.useRealTimers());

describe('useSettingsAccountActions', () => {
  it('resets onboarding after web confirmation and reports backend failure', async () => {
    const { result } = renderHook(() => useSettingsAccountActions());
    await act(async () => result.current.handleResetOnboarding());
    expect(mocks.confirm).toHaveBeenCalledWith('settings.resetOnboardingConfirmMsg');
    expect(mocks.resetOnboarding).toHaveBeenCalledOnce();
    expect(mocks.setLocal).toHaveBeenCalledWith('pending_basic_info');
    expect(mocks.setSkipped).toHaveBeenCalledWith(false);
    expect(mocks.replace).toHaveBeenCalledWith('/(onboarding)/about-intro');

    mocks.resetOnboarding.mockRejectedValueOnce(new Error('offline'));
    await act(async () => result.current.handleResetOnboarding());
    expect(mocks.alert).toHaveBeenCalledWith('settings.resetOnboardingFailed:offline');
    expect(result.current.resettingOnboarding).toBe(false);
  });

  it('uses native confirmation and alert, and skips duplicate or cancelled resets', async () => {
    mocks.platform.os = 'ios';
    const { result } = renderHook(() => useSettingsAccountActions());
    act(() => result.current.handleResetOnboarding());
    const actions = mocks.alert.mock.calls[0]?.[2] as Array<{ onPress?: () => void; style?: string }>;
    expect(actions.map((action) => action.style)).toEqual(['cancel', 'destructive']);
    act(() => actions[0]?.onPress?.());
    expect(mocks.resetOnboarding).not.toHaveBeenCalled();
    await act(async () => actions[1]?.onPress?.());
    expect(mocks.resetOnboarding).toHaveBeenCalledOnce();
    mocks.resetOnboarding.mockRejectedValueOnce('unknown');
    await act(async () => result.current.handleResetOnboarding());
    const errorActions = mocks.alert.mock.calls.at(-1)?.[2] as Array<{ onPress?: () => void }>;
    await act(async () => errorActions[1]?.onPress?.());
    expect(mocks.alert).toHaveBeenLastCalledWith('settings.resetOnboardingFailed:', 'general.unknownError');
  });

  it('signs out successfully, handles failure, and delays delete sign-out after success', async () => {
    const { result } = renderHook(() => useSettingsAccountActions());
    await act(async () => result.current.handleSignOut());
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith('/(auth)');
    mocks.signOut.mockRejectedValueOnce(new Error('offline'));
    await act(async () => result.current.handleSignOut());
    expect(mocks.alert).toHaveBeenCalledWith('general.error', 'settings.signOutFailed');
    expect(result.current.signingOut).toBe(false);

    vi.useFakeTimers();
    await act(async () => result.current.handleDeleteConfirm());
    expect(mocks.deleteExecute).toHaveBeenCalledTimes(1);
    expect(result.current.deleteModalVisible).toBe(false);
    expect(result.current.deleteSuccessVisible).toBe(true);
    expect(mocks.signOut).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTime(1500));
    expect(mocks.signOut).toHaveBeenCalledTimes(3);
    expect(result.current.deleteSuccessVisible).toBe(false);
    expect(mocks.replace).toHaveBeenLastCalledWith('/(auth)');
  });

  it('does not reset when web confirmation is declined', () => {
    mocks.confirm.mockReturnValue(false);
    const { result } = renderHook(() => useSettingsAccountActions());
    act(() => result.current.handleResetOnboarding());
    expect(mocks.resetOnboarding).not.toHaveBeenCalled();
    expect(result.current.resettingOnboarding).toBe(false);
  });
});
