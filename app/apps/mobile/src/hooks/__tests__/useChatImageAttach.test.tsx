// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const { pickChatImage, uploadChatImageAndSend, sendMediaMessage, appendOptimistic } = vi.hoisted(() => ({
  pickChatImage: vi.fn(),
  uploadChatImageAndSend: vi.fn(),
  sendMediaMessage: vi.fn(),
  appendOptimistic: vi.fn(),
}));
vi.mock('../../services/chatMediaUpload', () => ({ pickChatImage, uploadChatImageAndSend }));
vi.mock('../../lib/container', () => ({ container: { chatV2Repo: { sendMediaMessage } } }));
vi.mock('../../store/chatStore', () => ({ useChatStore: { getState: () => ({ appendOptimistic }) } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { useChatImageAttach } from '../useChatImageAttach';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('useChatImageAttach', () => {
  it('uploads a picked image', async () => {
    pickChatImage.mockResolvedValue({ status: 'ok', value: { uri: 'file://a', width: 1, height: 1 } });
    uploadChatImageAndSend.mockImplementation(async (_c, _u, _p, send) => { await send({ type: 'image' }); });
    sendMediaMessage.mockResolvedValue({ messageId: 'm1' });
    const onError = vi.fn();
    const { result } = renderHook(() => useChatImageAttach({ chatId: 'c1', userId: 'u1', onError }));
    await act(async () => { await result.current.attach(); });
    expect(uploadChatImageAndSend).toHaveBeenCalled();
    expect(appendOptimistic).toHaveBeenCalledWith('c1', expect.objectContaining({ clientId: 'm1' }));
    expect(result.current.permissionBlocked).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it('surfaces a blocked photo-library permission without uploading', async () => {
    pickChatImage.mockResolvedValue({ status: 'blocked', kind: 'mediaLibrary' });
    const onError = vi.fn();
    const { result } = renderHook(() => useChatImageAttach({ chatId: 'c1', userId: 'u1', onError }));
    await act(async () => { await result.current.attach(); });
    expect(result.current.permissionBlocked).toBe('mediaLibrary');
    expect(uploadChatImageAndSend).not.toHaveBeenCalled();
  });
});
