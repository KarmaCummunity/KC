// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
const m = vi.hoisted(() => ({ hasSent: vi.fn(), send: vi.fn(), append: vi.fn(), reconcile: vi.fn(), failed: vi.fn(), uuid: vi.fn(() => 'client-1'), t: vi.fn((k: string) => k) }));
vi.mock('../../lib/container', () => ({ container: { chatRepo: { hasSentAnyMessage: m.hasSent }, sendMessage: { execute: m.send } } }));
vi.mock('../../store/chatStore', () => ({ useChatStore: { getState: () => ({ appendOptimistic: m.append, reconcileSent: m.reconcile, markFailed: m.failed }) } }));
vi.mock('expo-crypto', () => ({ randomUUID: m.uuid }));
vi.mock('../../i18n', () => ({ default: { t: m.t } }));
import { useChatSend } from '../useChatSend';
describe('useChatSend', () => {
  beforeEach(() => vi.clearAllMocks());
  it('trims and optimistically inserts a valid send, clears input and prompts on first send', async () => {
    m.hasSent.mockResolvedValue(false); m.send.mockResolvedValue({ messageId: 'server-1' });
    const setInput = vi.fn(), prompt = vi.fn();
    const { result } = renderHook(() => useChatSend({ chatId: 'c1', userId: 'u1', input: ' hello ', setInput, presentPrePrompt: prompt, setNotify: vi.fn() }));
    await act(async () => result.current());
    expect(m.append).toHaveBeenCalledWith('c1', expect.objectContaining({ messageId: 'client-1', body: 'hello', status: 'pending' }));
    expect(m.send).toHaveBeenCalledWith({ chatId: 'c1', senderId: 'u1', body: 'hello', clientId: 'client-1' });
    expect(m.reconcile).toHaveBeenCalledWith('c1', 'client-1', { messageId: 'server-1' });
    expect(setInput).toHaveBeenCalledWith(''); expect(prompt).toHaveBeenCalledWith('first-message-sent');
  });
  it('skips blank input and marks a failed send with deleted-user feedback', async () => {
    const setNotify = vi.fn();
    const { result } = renderHook(({ input }) => useChatSend({ chatId: 'c1', userId: 'u1', input, setInput: vi.fn(), presentPrePrompt: vi.fn(), setNotify }), { initialProps: { input: '  ' } });
    await act(async () => result.current());
    expect(m.send).not.toHaveBeenCalled();
    m.hasSent.mockResolvedValue(true);
    const { result: send } = renderHook(() => useChatSend({ chatId: 'c1', userId: 'u1', input: 'hi', setInput: vi.fn(), presentPrePrompt: vi.fn(), setNotify }));
    const { ChatError } = await import('@kc/application');
    m.send.mockRejectedValue(new ChatError('send_to_deleted_user', 'Unavailable'));
    await act(async () => send.current());
    expect(m.failed).toHaveBeenCalledWith('c1', 'client-1');
    expect(setNotify).toHaveBeenCalledWith({ title: 'errors.chat.userUnavailableTitle', message: 'errors.chat.userUnavailableMessage' });
  });
  it('rejects oversized input and an empty override without touching chat state', async () => {
    const setInput = vi.fn();
    const { result } = renderHook(({ input }) => useChatSend({ chatId: 'c1', userId: 'u1', input, setInput, presentPrePrompt: vi.fn(), setNotify: vi.fn() }), { initialProps: { input: 'x'.repeat(5001) } });
    await act(async () => result.current());
    await act(async () => result.current('custom-id', '  '));
    expect(m.send).not.toHaveBeenCalled(); expect(m.append).not.toHaveBeenCalled(); expect(setInput).not.toHaveBeenCalled();
  });
  it('uses override body and client id without optimistic insertion or clearing input', async () => {
    m.hasSent.mockResolvedValue(true); m.send.mockResolvedValue({ messageId: 'server-2' });
    const setInput = vi.fn(); const { result } = renderHook(() => useChatSend({ chatId: 'c2', userId: 'u2', input: 'ignored', setInput, presentPrePrompt: vi.fn(), setNotify: vi.fn() }));
    await act(async () => result.current('chosen-id', '  custom body  '));
    expect(m.send).toHaveBeenCalledWith({ chatId: 'c2', senderId: 'u2', body: 'custom body', clientId: 'chosen-id' });
    expect(m.reconcile).toHaveBeenCalledWith('c2', 'chosen-id', { messageId: 'server-2' });
    expect(m.append).not.toHaveBeenCalled(); expect(setInput).not.toHaveBeenCalled(); expect(m.uuid).not.toHaveBeenCalled();
  });
  it('continues sending when first-send lookup rejects and does not prompt', async () => {
    m.hasSent.mockRejectedValue(new Error('offline')); m.send.mockResolvedValue({ messageId: 'server-3' });
    const prompt = vi.fn(); const { result } = renderHook(() => useChatSend({ chatId: 'c1', userId: 'u1', input: 'ok', setInput: vi.fn(), presentPrePrompt: prompt, setNotify: vi.fn() }));
    await act(async () => result.current());
    expect(m.send).toHaveBeenCalledWith({ chatId: 'c1', senderId: 'u1', body: 'ok', clientId: 'client-1' }); expect(prompt).not.toHaveBeenCalled();
  });
  it('marks ordinary send rejection failed without exposing a deleted-user notice', async () => {
    m.hasSent.mockResolvedValue(true); m.send.mockRejectedValue(new Error('offline'));
    const notify = vi.fn(); const { result } = renderHook(() => useChatSend({ chatId: 'c1', userId: 'u1', input: 'ok', setInput: vi.fn(), presentPrePrompt: vi.fn(), setNotify: notify }));
    await act(async () => result.current());
    expect(m.failed).toHaveBeenCalledWith('c1', 'client-1'); expect(notify).not.toHaveBeenCalled(); expect(m.reconcile).not.toHaveBeenCalled();
  });
  it('enqueues to outbox immediately when offline without attempting network send', async () => {
    const { useNetworkStatusStore } = await import('../../lib/networkStatusStore');
    const { useOutboxStore } = await import('../../store/outboxStore');
    useNetworkStatusStore.setState({ isOnline: false, isInternetReachable: false });
    const setInput = vi.fn();
    const { result } = renderHook(() => useChatSend({ chatId: 'c_off', userId: 'u_off', input: 'offline msg', setInput, presentPrePrompt: vi.fn(), setNotify: vi.fn() }));
    await act(async () => result.current());
    expect(m.send).not.toHaveBeenCalled();
    expect(m.append).toHaveBeenCalledWith('c_off', expect.objectContaining({ body: 'offline msg', status: 'pending' }));
    expect(setInput).toHaveBeenCalledWith('');
    expect(useOutboxStore.getState().items.some((i) => i.idempotencyKey === 'chat:c_off:client-1')).toBe(true);
    useNetworkStatusStore.setState({ isOnline: true, isInternetReachable: true });
  });
});
