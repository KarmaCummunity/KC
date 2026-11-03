// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const { hasSentAnyMessage, execute, appendOptimistic, reconcileSent, markFailed, randomUUID } = vi.hoisted(() => ({
  hasSentAnyMessage: vi.fn(), execute: vi.fn(), appendOptimistic: vi.fn(),
  reconcileSent: vi.fn(), markFailed: vi.fn(), randomUUID: vi.fn(() => 'generated-id'),
}));
vi.mock('../../lib/container', () => ({ container: { chatRepo: { hasSentAnyMessage }, sendMessage: { execute } } }));
vi.mock('../../store/chatStore', () => ({ useChatStore: { getState: () => ({ appendOptimistic, reconcileSent, markFailed }) } }));
vi.mock('expo-crypto', () => ({ randomUUID }));
vi.mock('../../i18n', () => ({ default: { t: (key: string) => key } }));

import { useChatSend } from '../useChatSend';

beforeEach(() => {
  vi.clearAllMocks();
  hasSentAnyMessage.mockResolvedValue(true);
  execute.mockResolvedValue({ messageId: 'server-id' });
});

describe('useChatSend', () => {
  it('ignores empty and oversized messages', async () => {
    const { result } = renderHook(() => useChatSend({ chatId: 'c1', userId: 'u1', input: '  ', setInput: vi.fn(), presentPrePrompt: vi.fn(), setNotify: vi.fn() }));
    await act(async () => result.current());
    await act(async () => result.current(undefined, 'x'.repeat(2001)));
    expect(execute).not.toHaveBeenCalled();
    expect(appendOptimistic).not.toHaveBeenCalled();
  });

  it('trims, inserts optimistically, clears input, and reconciles generated IDs', async () => {
    const setInput = vi.fn();
    const { result } = renderHook(() => useChatSend({ chatId: 'c1', userId: 'u1', input: ' hello ', setInput, presentPrePrompt: vi.fn(), setNotify: vi.fn() }));
    await act(async () => result.current());
    expect(appendOptimistic).toHaveBeenCalledWith('c1', expect.objectContaining({ messageId: 'generated-id', body: 'hello', status: 'pending' }));
    expect(setInput).toHaveBeenCalledWith('');
    expect(execute).toHaveBeenCalledWith({ chatId: 'c1', senderId: 'u1', body: 'hello' });
    expect(reconcileSent).toHaveBeenCalledWith('c1', 'generated-id', { messageId: 'server-id' });
  });

  it('uses overrides without optimistic insert, prompts on first send, and marks failures', async () => {
    hasSentAnyMessage.mockResolvedValue(false);
    const prePrompt = vi.fn();
    const setNotify = vi.fn();
    const { result } = renderHook(() => useChatSend({ chatId: 'c1', userId: 'u1', input: 'ignored', setInput: vi.fn(), presentPrePrompt: prePrompt, setNotify }));
    await act(async () => result.current('known-id', ' override '));
    expect(execute).toHaveBeenCalledWith({ chatId: 'c1', senderId: 'u1', body: 'override' });
    expect(appendOptimistic).not.toHaveBeenCalled();
    expect(reconcileSent).toHaveBeenCalledWith('c1', 'known-id', { messageId: 'server-id' });
    expect(prePrompt).toHaveBeenCalledWith('first-message-sent');
    expect(setNotify).not.toHaveBeenCalled();
  });

  it('marks a rejected send failed and surfaces the deleted-user error', async () => {
    const { ChatError } = await import('@kc/application');
    execute.mockRejectedValueOnce(new ChatError('send_to_deleted_user', 'Unavailable'));
    const setNotify = vi.fn();
    const { result } = renderHook(() => useChatSend({ chatId: 'c1', userId: 'u1', input: 'hello', setInput: vi.fn(), presentPrePrompt: vi.fn(), setNotify }));
    await act(async () => result.current('fixed-id'));
    expect(markFailed).toHaveBeenCalledWith('c1', 'fixed-id');
    expect(setNotify).toHaveBeenCalledWith({ title: 'errors.chat.userUnavailableTitle', message: 'errors.chat.userUnavailableMessage' });
  });
});
