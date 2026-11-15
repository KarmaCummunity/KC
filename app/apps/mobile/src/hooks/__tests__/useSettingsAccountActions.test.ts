// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteExecute: vi.fn(), signOut: vi.fn(),
  replace: vi.fn(), t: vi.fn((key: string, options?: { msg?: string }) => options ? `${key}:${options.msg}` : key),
  alert: vi.fn(),
}));
vi.mock('../../services/userComposition', () => ({
  getDeleteAccountUseCase: () => ({ execute: mocks.deleteExecute }),
}));
vi.mock('../../services/performFullSignOut', () => ({ performFullSignOut: mocks.signOut }));
vi.mock('../../store/authStore', () => ({
  useAuthStore: (selector: (state: { signOut: typeof mocks.signOut }) => unknown) =>
    selector({ signOut: mocks.signOut }),
}));
vi.mock('expo-router', () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ clear: vi.fn() }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  return { ...actual, Alert: { ...actual.Alert, alert: (...args: unknown[]) => mocks.alert(...args) } };
});
vi.mock('../../lib/container', () => ({ container: { deviceRepo: { deactivate: vi.fn() } } }));
import { useSettingsAccountActions } from '../useSettingsAccountActions';

beforeEach(() => {
  vi.useRealTimers(); vi.clearAllMocks();
  mocks.deleteExecute.mockResolvedValue(undefined);
  mocks.signOut.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe('useSettingsAccountActions', () => {
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

  it('keeps the member signed in and the success overlay hidden when the deletion request is refused', async () => {
    mocks.deleteExecute.mockRejectedValueOnce(new Error('suspended'));
    const { result } = renderHook(() => useSettingsAccountActions());

    await expect(act(async () => result.current.handleDeleteConfirm())).rejects.toThrow('suspended');

    expect(result.current.deleteSuccessVisible).toBe(false);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
});
