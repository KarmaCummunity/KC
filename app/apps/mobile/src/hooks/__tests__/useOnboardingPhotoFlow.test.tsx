// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const { state, replace, alert, pickAvatarImage, removeUploadedAvatar, resizeAndUploadAvatar, setAvatar, complete, t } = vi.hoisted(() => ({
  state: { session: null as { userId: string; avatarUrl: string | null } | null, onboardingState: 'pending_avatar' as string, setSession: vi.fn(), setOnboardingState: vi.fn() },
  replace: vi.fn(), alert: vi.fn(), pickAvatarImage: vi.fn(), removeUploadedAvatar: vi.fn(), resizeAndUploadAvatar: vi.fn(), setAvatar: vi.fn(), complete: vi.fn(), t: (key: string) => key,
}));
vi.mock('expo-router', () => ({ useRouter: () => ({ replace }) }));
vi.mock('react-native', () => ({ Alert: { alert } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }));
vi.mock('../../store/authStore', () => ({ useAuthStore: (selector: (s: typeof state) => unknown) => selector(state) }));
vi.mock('../../services/userComposition', () => ({ getSetAvatarUseCase: () => ({ execute: setAvatar }), getCompleteOnboardingUseCase: () => ({ execute: complete }) }));
vi.mock('../../services/avatarUpload', () => ({ pickAvatarImage, removeUploadedAvatar, resizeAndUploadAvatar }));
import { useOnboardingPhotoFlow } from '../useOnboardingPhotoFlow';

beforeEach(() => { vi.clearAllMocks(); state.session = { userId: 'u1', avatarUrl: null }; state.onboardingState = 'pending_avatar'; });

describe('useOnboardingPhotoFlow', () => {
  it('picks and stores an avatar; a cancelled picker leaves it unset', async () => {
    pickAvatarImage.mockResolvedValueOnce({ uri: 'local' }).mockResolvedValueOnce(null);
    resizeAndUploadAvatar.mockResolvedValue('remote'); setAvatar.mockResolvedValue(undefined);
    const { result } = renderHook(() => useOnboardingPhotoFlow());
    await act(async () => { await result.current.pick('gallery'); });
    expect(pickAvatarImage).toHaveBeenCalledWith('gallery');
    expect(resizeAndUploadAvatar).toHaveBeenCalledWith({ uri: 'local' }, 'u1');
    expect(setAvatar).toHaveBeenCalledWith({ sessionUserId: 'u1', userId: 'u1', avatarUrl: 'remote' });
    expect(state.setSession).toHaveBeenCalledWith({ userId: 'u1', avatarUrl: 'remote' });
    await act(async () => { await result.current.pick('camera'); });
    expect(resizeAndUploadAvatar).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(false);
  });
  it('reports picker and removal errors and always clears uploading', async () => {
    pickAvatarImage.mockRejectedValueOnce(new Error('picker')).mockResolvedValueOnce({ uri: 'x' });
    resizeAndUploadAvatar.mockRejectedValueOnce('bad'); removeUploadedAvatar.mockRejectedValueOnce(new Error('delete'));
    const { result } = renderHook(() => useOnboardingPhotoFlow());
    await act(async () => { await result.current.pick('camera'); });
    expect(alert).toHaveBeenCalledWith('onboarding.uploadFailed', 'onboarding.uploadFailedBody\npicker');
    await act(async () => { await result.current.pick('camera'); });
    expect(alert).toHaveBeenLastCalledWith('onboarding.uploadFailed', 'onboarding.uploadFailedBody\ngeneral.unknownError');
    await act(async () => { await result.current.remove(); });
    expect(alert).toHaveBeenLastCalledWith('onboarding.removeFailed', 'delete');
    expect(result.current.uploading).toBe(false);
  });
  it('removes avatar then finalizes pending onboarding; finalization failure stays put', async () => {
    removeUploadedAvatar.mockResolvedValue(undefined); setAvatar.mockResolvedValue(undefined);
    complete.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('save'));
    const { result, rerender } = renderHook(() => useOnboardingPhotoFlow());
    await act(async () => { await result.current.remove(); });
    expect(removeUploadedAvatar).toHaveBeenCalledWith('u1');
    expect(setAvatar).toHaveBeenCalledWith({ sessionUserId: 'u1', userId: 'u1', avatarUrl: null });
    await act(async () => { await result.current.finalize(); });
    expect(complete).toHaveBeenCalledWith({ userId: 'u1' });
    expect(state.setOnboardingState).toHaveBeenCalledWith('completed');
    expect(replace).toHaveBeenCalledWith('/(onboarding)/tour');
    state.onboardingState = 'pending_avatar';
    complete.mockRejectedValueOnce(new Error('save'));
    rerender();
    await act(async () => { await result.current.finalize(); });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(alert).toHaveBeenCalledWith('onboarding.saveFailed', 'save');
    expect(result.current.finalizing).toBe(false);
  });
  it('guards signed-out actions and blocks back navigation while busy', async () => {
    state.session = null;
    const { result, rerender } = renderHook(() => useOnboardingPhotoFlow());
    await act(async () => { await result.current.pick('camera'); await result.current.remove(); await result.current.finalize(); });
    expect(pickAvatarImage).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
    state.session = { userId: 'u1', avatarUrl: null }; pickAvatarImage.mockReturnValue(new Promise(() => {})); rerender();
    await act(async () => { void result.current.pick('camera'); });
    act(() => result.current.goBack()); expect(replace).not.toHaveBeenCalled();
  });
});
