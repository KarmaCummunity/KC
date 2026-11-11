import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    default: {
      getItem: (k: string) => Promise.resolve(store.get(k) ?? null),
      setItem: (k: string, v: string) => Promise.resolve(void store.set(k, v)),
      removeItem: (k: string) => Promise.resolve(void store.delete(k)),
      clear: () => Promise.resolve(void store.clear()),
    },
  };
});

import { calculateBackoffDelay, isFatalError, flushOutbox } from '../outboxRunner';
import { useOutboxStore } from '../../store/outboxStore';
import { useNetworkStatusStore } from '../networkStatusStore';
import { container } from '../container';

vi.mock('../container', () => ({
  container: {
    sendMessage: {
      execute: vi.fn(),
    },
  },
}));

vi.mock('../../store/chatStore', () => ({
  useChatStore: {
    getState: () => ({
      reconcileSent: vi.fn(),
    }),
  },
}));

vi.mock('../../services/postsComposition', () => ({
  getCreatePostUseCase: () => ({
    execute: vi.fn(),
  }),
}));

vi.mock('../../services/givingHandoffComposition', () => ({
  givingHandoffUseCases: {
    reserveItem: () => ({ execute: vi.fn() }),
    claimFood: () => ({ execute: vi.fn() }),
    confirmItem: () => ({ execute: vi.fn() }),
  },
}));

describe('outboxRunner', () => {
  beforeEach(() => {
    useOutboxStore.getState().clearAll();
    useNetworkStatusStore.setState({ isOnline: true, isInternetReachable: true });
    vi.clearAllMocks();
  });

  it('calculates exponential backoff delay correctly', () => {
    const d0 = calculateBackoffDelay(0, 1000, 30000, 0);
    const d1 = calculateBackoffDelay(1, 1000, 30000, 0);
    const d2 = calculateBackoffDelay(2, 1000, 30000, 0);

    expect(d0).toBe(1000);
    expect(d1).toBe(2000);
    expect(d2).toBe(4000);
  });

  it('correctly identifies fatal errors', () => {
    expect(isFatalError(new Error('listing_not_available'))).toBe(true);
    expect(isFatalError(new Error('seats_exhausted'))).toBe(true);
    expect(isFatalError(new Error('Network request failed'))).toBe(false);
  });

  it('flushes queued chat messages when online', async () => {
    (container.sendMessage.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      messageId: 'srv-1',
      chatId: 'c1',
      body: 'Hi',
    });

    useOutboxStore.getState().enqueue({
      entityType: 'chat_message',
      action: 'send_message',
      payload: { chatId: 'c1', senderId: 'u1', body: 'Hi', clientId: 'cli-1' },
      idempotencyKey: 'chat:c1:cli-1',
    });

    await flushOutbox();

    expect(container.sendMessage.execute).toHaveBeenCalledWith({
      chatId: 'c1',
      senderId: 'u1',
      body: 'Hi',
      clientId: 'cli-1',
    });
    expect(useOutboxStore.getState().items).toHaveLength(0);
  });

  it('does not flush when offline', async () => {
    useNetworkStatusStore.setState({ isOnline: false, isInternetReachable: false });

    useOutboxStore.getState().enqueue({
      entityType: 'chat_message',
      action: 'send_message',
      payload: { chatId: 'c1', senderId: 'u1', body: 'Hi', clientId: 'cli-1' },
      idempotencyKey: 'chat:c1:cli-1',
    });

    await flushOutbox();

    expect(container.sendMessage.execute).not.toHaveBeenCalled();
    expect(useOutboxStore.getState().items[0]?.status).toBe('queued');
  });
});
