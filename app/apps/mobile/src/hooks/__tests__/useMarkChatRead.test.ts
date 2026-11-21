// @vitest-environment jsdom
// FR-CHAT-012 — the conversation screen's read acknowledgement (#2566: at most one on entry).
// Replaces the source-slicing `chatMarkReadBoundary` test with a real render of the hook; it keeps
// every case that test proved (no local read before the write succeeds, a contained rejection
// without retry, nothing sent with nothing unread, the screen wiring).
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { OptimisticMessage } from '../../store/chatStore';

const m = vi.hoisted(() => ({
  markRead: vi.fn(),
  markLocal: vi.fn(),
  report: vi.fn(),
  threads: {} as Record<string, unknown[]>,
}));

vi.mock('../../lib/container', () => ({ container: { markChatRead: { execute: m.markRead } } }));
vi.mock('../../store/chatStore', () => {
  const state = () => ({ threads: m.threads, markChatLocallyRead: m.markLocal });
  // The hook both subscribes (`useChatStore(selector)`) and reads imperatively (`getState()`).
  const useChatStore = (selector: (s: ReturnType<typeof state>) => unknown) => selector(state());
  useChatStore.getState = state;
  return { useChatStore };
});
vi.mock('../../lib/observability/reportHandledError', () => ({ reportHandledError: m.report }));

import { useMarkChatRead } from '../useMarkChatRead';

const message = (id: string, senderId: string, status: OptimisticMessage['status'], createdAt: string): OptimisticMessage => ({
  messageId: id,
  clientId: id,
  chatId: 'chat1',
  senderId,
  kind: 'user',
  body: id,
  systemPayload: null,
  mediaPayload: null,
  status,
  createdAt,
  deliveredAt: createdAt,
  readAt: null,
});

const READ = message('m0', 'peer', 'read', '2026-11-20T09:00:00.000Z');
const UNREAD = message('m1', 'peer', 'delivered', '2026-11-20T10:00:00.000Z');
const MINE = message('m2', 'user1', 'delivered', '2026-11-20T11:00:00.000Z');

describe('useMarkChatRead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.threads = {};
    m.markRead.mockResolvedValue(undefined);
  });

  it('wires the acknowledgement hook into the conversation screen with the entry hint', () => {
    const screen = readFileSync(fileURLToPath(new NodeURL('../../../app/chat/[id].tsx', import.meta.url)), 'utf8');
    expect(screen).toContain("import { useMarkChatRead } from '../../src/hooks/useMarkChatRead';");
    expect(screen).toContain('useMarkChatRead(messages, chatId, userId, initiallyUnread);');
  });

  it('waits for the first page, then sends one acknowledgement for an unread entry', async () => {
    const entry = renderHook(({ messages }) => useMarkChatRead(messages, 'chat1', 'user1', true), {
      initialProps: { messages: [] as OptimisticMessage[] },
    });
    await act(async () => undefined);
    expect(m.markRead).not.toHaveBeenCalled();

    // The first page lands with an unread message: one request covers both the entry and the page.
    m.threads = { chat1: [UNREAD] };
    entry.rerender({ messages: [UNREAD] });
    await waitFor(() => expect(m.markLocal).toHaveBeenCalledWith('chat1'));
    expect(m.markRead).toHaveBeenCalledExactlyOnceWith({ chatId: 'chat1', userId: 'user1' });
  });

  it('does not mark locally read until the write succeeds', async () => {
    m.threads = { chat1: [READ, UNREAD, MINE] };
    let complete!: () => void;
    m.markRead.mockReturnValue(new Promise<void>((resolve) => (complete = resolve)));

    renderHook(() => useMarkChatRead([READ, UNREAD, MINE], 'chat1', 'user1', false));

    expect(m.markLocal).not.toHaveBeenCalled();
    await act(async () => complete());
    expect(m.markLocal).toHaveBeenCalledExactlyOnceWith('chat1');
    // The acknowledged message keeps a stale local status (no broadcast yet) without a resend.
    expect(m.markRead).toHaveBeenCalledTimes(1);
    expect(m.report).not.toHaveBeenCalled();
  });

  it('sends once more for a message that arrived while the acknowledgement was in flight', async () => {
    m.threads = { chat1: [UNREAD] };
    let complete!: () => void;
    m.markRead.mockReturnValueOnce(new Promise<void>((resolve) => (complete = resolve)));
    const hook = renderHook(({ messages }) => useMarkChatRead(messages, 'chat1', 'user1', false), {
      initialProps: { messages: [UNREAD] },
    });
    const late = message('m3', 'peer', 'delivered', '2026-11-20T12:00:00.000Z');
    m.threads = { chat1: [UNREAD, late] };
    hook.rerender({ messages: [UNREAD, late] });

    await act(async () => complete());
    await waitFor(() => expect(m.markRead).toHaveBeenCalledTimes(2));
    await act(async () => undefined);
    // Both are now behind the watermark: nothing further is sent.
    expect(m.markRead).toHaveBeenCalledTimes(2);
  });

  it('never loops on a message whose time cannot be parsed', async () => {
    const broken = message('m4', 'peer', 'delivered', 'not-a-date');
    m.threads = { chat1: [broken] };
    renderHook(() => useMarkChatRead([broken], 'chat1', 'user1', true));
    await waitFor(() => expect(m.markRead).toHaveBeenCalledTimes(1));
    await act(async () => undefined);
    expect(m.markRead).toHaveBeenCalledTimes(1);
  });

  it('contains a rejection and reports it without false read state or retry', async () => {
    m.threads = { chat1: [UNREAD] };
    const error = new Error('canceling statement due to statement timeout');
    m.markRead.mockRejectedValue(error);

    renderHook(() => useMarkChatRead([UNREAD], 'chat1', 'user1', true));

    await waitFor(() => expect(m.report).toHaveBeenCalledExactlyOnceWith(error, 'manual', ['chat', 'mark-read']));
    expect(m.markRead).toHaveBeenCalledTimes(1);
    expect(m.markLocal).not.toHaveBeenCalled();
  });

  it('sends nothing when the inbox shows the chat read and no incoming message is unread', async () => {
    renderHook(() => useMarkChatRead([READ, MINE], 'chat1', 'user1', false));
    await act(async () => undefined);
    expect(m.markRead).not.toHaveBeenCalled();
    expect(m.markLocal).not.toHaveBeenCalled();
  });

  it('acknowledges entry when the inbox shows unread messages the page cannot (e.g. a system message)', async () => {
    m.threads = { chat1: [READ] };
    renderHook(() => useMarkChatRead([READ], 'chat1', 'user1', true));
    await waitFor(() => expect(m.markRead).toHaveBeenCalledTimes(1));
  });

  it('acknowledges again when a new incoming message arrives after a read state', async () => {
    m.threads = { chat1: [READ] };
    const hook = renderHook(({ messages }) => useMarkChatRead(messages, 'chat1', 'user1', false), {
      initialProps: { messages: [READ] },
    });
    expect(m.markRead).not.toHaveBeenCalled();
    hook.rerender({ messages: [READ, UNREAD] });
    await waitFor(() => expect(m.markRead).toHaveBeenCalledTimes(1));
  });
});
