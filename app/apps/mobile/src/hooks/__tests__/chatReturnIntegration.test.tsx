// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ChatWithPreview, IChatRealtime, IChatRepository } from '@kc/application';
import type { ChatState } from '../../store/chatStoreTypes';
import { runStartInboxSub } from '../../store/chatStoreInboxLifecycle';

const { repo } = vi.hoisted(() => ({ repo: { getMyChats: vi.fn(), getUnreadTotal: vi.fn() } }));
vi.mock('../../lib/container', () => ({ container: { chatRepo: repo } }));
import { useChatInboxQuery } from '../useChatInboxQuery';

afterEach(cleanup);

it('preserves a hidden inbox invalidation through the delayed unread callback, then refreshes once on return', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
  const before = { chatId: 'synthetic-c1', lastMessage: { body: 'before' } } as ChatWithPreview;
  const after = { chatId: 'synthetic-c1', lastMessage: { body: 'after' } } as ChatWithPreview;
  repo.getMyChats.mockResolvedValue([before]);
  repo.getUnreadTotal.mockResolvedValue(0);
  let handlers: Parameters<IChatRealtime['subscribeToInbox']>[1] | undefined;
  const noop = () => {};
  const state = { inboxSub: noop, inboxSnapshotEpoch: 0, unreadTotal: 0 } as ChatState;
  await runStartInboxSub(
    { getState: () => state, setState: (partial) => { Object.assign(state, partial); } },
    noop, 'synthetic-u1', repo as unknown as IChatRepository,
    { subscribeToInbox: (_userId, callbacks) => { handlers = callbacks; return noop; } } as IChatRealtime, qc,
  );
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result, rerender } = renderHook(({ subscribed }) => useChatInboxQuery('synthetic-u1', { subscribed }), {
    wrapper, initialProps: { subscribed: true },
  });
  await waitFor(() => expect(result.current.data?.chats[0]?.lastMessage?.body).toBe('before'));
  const initialReads = repo.getMyChats.mock.calls.length;
  rerender({ subscribed: false });
  repo.getMyChats.mockResolvedValue([after]);
  // Actual adapter order: chat_updated invalidates, then the debounced unread RPC returns.
  handlers!.onInboxChanged({ chatId: 'synthetic-c1', lastMessageAt: null });
  await Promise.resolve();
  handlers!.onUnreadTotalChanged(0);
  expect(repo.getMyChats).toHaveBeenCalledTimes(initialReads);
  expect(qc.getQueryState(['chat-inbox', 'synthetic-u1'])?.isInvalidated).toBe(true);
  rerender({ subscribed: true });
  await waitFor(() => expect(result.current.data?.chats[0]?.lastMessage?.body).toBe('after'));
  expect(repo.getMyChats).toHaveBeenCalledTimes(initialReads + 1);
  qc.clear();
});
