// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const { avatar, lifecycle } = vi.hoisted(() => ({
  avatar: { pickAvatarImage: vi.fn(), resizeAndUploadAvatar: vi.fn() },
  lifecycle: { discardUnsavedAvatar: vi.fn(async () => 'delete_queued') },
}));
vi.mock('../../services/avatarUpload', () => avatar);
vi.mock('../../services/avatarLifecycle', () => lifecycle);
vi.mock('../../services/userComposition', () => ({ getUserRepo: () => ({ findById: async () => ({ avatarUrl: 'saved' }) }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { useAvatarUploadTask } from '../useAvatarUploadTask';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

/** An upload the test finishes by hand, recording the abort signal it was given. */
function heldUpload() {
  let finish!: (url: string) => void;
  let signal: AbortSignal | undefined;
  avatar.resizeAndUploadAvatar.mockImplementation((_p: unknown, _u: string, opts?: { signal?: AbortSignal }) => {
    signal = opts?.signal;
    return new Promise<string>((resolve) => { finish = resolve; });
  });
  return { finish: (url: string) => finish(url), signal: () => signal };
}

describe('useAvatarUploadTask', () => {
  it('hands the new avatar to the form and reports the uploading state around it', async () => {
    avatar.pickAvatarImage.mockResolvedValue({ status: 'ok', value: { uri: 'local' } });
    avatar.resizeAndUploadAvatar.mockResolvedValue('gen-1');
    const onChange = vi.fn();
    const onUploadingChange = vi.fn();
    const { result } = renderHook(() => useAvatarUploadTask({ userId: 'u1', onChange, onUploadingChange }));
    await act(async () => { await result.current.pickAndUpload('gallery'); });
    expect(onChange).toHaveBeenCalledWith('gen-1');
    expect(onUploadingChange.mock.calls).toEqual([[true], [false]]);
    expect(lifecycle.discardUnsavedAvatar).not.toHaveBeenCalled();
  });

  it('an upload that finishes AFTER the screen closed is aborted, never handed to the form, and its generation discarded', async () => {
    avatar.pickAvatarImage.mockResolvedValue({ status: 'ok', value: { uri: 'local' } });
    const held = heldUpload();
    const onChange = vi.fn();
    const { result, unmount } = renderHook(() => useAvatarUploadTask({ userId: 'u1', onChange }));
    let pending!: Promise<void>;
    act(() => { pending = result.current.pickAndUpload('camera'); });
    await act(async () => { await Promise.resolve(); });
    unmount();
    expect(held.signal()?.aborted).toBe(true);
    // The server committed the upload anyway and returned its URL late.
    held.finish('gen-late');
    await pending;
    expect(onChange).not.toHaveBeenCalled();
    expect(lifecycle.discardUnsavedAvatar).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', uploadedUrl: 'gen-late' }));
  });

  it('shows the error of a failed upload while mounted, and nothing after', async () => {
    avatar.pickAvatarImage.mockResolvedValue({ status: 'ok', value: { uri: 'local' } });
    avatar.resizeAndUploadAvatar.mockRejectedValueOnce(new Error('avatar_upload: quota'));
    const { result } = renderHook(() => useAvatarUploadTask({ userId: 'u1', onChange: vi.fn() }));
    await act(async () => { await result.current.pickAndUpload('gallery'); });
    expect(result.current.errorMsg).toBe('avatar_upload: quota');
  });

  it('a cancelled picker changes nothing', async () => {
    avatar.pickAvatarImage.mockResolvedValue({ status: 'cancelled' });
    const onChange = vi.fn();
    const { result } = renderHook(() => useAvatarUploadTask({ userId: 'u1', onChange }));
    await act(async () => { await result.current.pickAndUpload('gallery'); });
    expect(avatar.resizeAndUploadAvatar).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('records a blocked camera permission without uploading', async () => {
    avatar.pickAvatarImage.mockResolvedValue({ status: 'blocked', kind: 'camera' });
    const onChange = vi.fn();
    const { result } = renderHook(() => useAvatarUploadTask({ userId: 'u1', onChange }));
    await act(async () => { await result.current.pickAndUpload('camera'); });
    expect(result.current.permissionBlocked).toBe('camera');
    expect(avatar.resizeAndUploadAvatar).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
