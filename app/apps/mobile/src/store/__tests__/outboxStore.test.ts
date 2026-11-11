import { describe, it, expect, beforeEach, vi } from 'vitest';

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

import { useOutboxStore } from '../outboxStore';

describe('outboxStore', () => {
  beforeEach(() => {
    useOutboxStore.getState().clearAll();
  });

  it('enqueues an item with default values and deduplicates by idempotencyKey', () => {
    const item1 = useOutboxStore.getState().enqueue({
      entityType: 'post',
      action: 'create_post',
      payload: { title: 'Test' },
      idempotencyKey: 'post:123',
    });

    expect(item1.status).toBe('queued');
    expect(item1.attempts).toBe(0);
    expect(useOutboxStore.getState().items).toHaveLength(1);

    // Enqueue duplicate idempotencyKey replaces prior item
    useOutboxStore.getState().enqueue({
      entityType: 'post',
      action: 'create_post',
      payload: { title: 'Updated' },
      idempotencyKey: 'post:123',
    });

    expect(useOutboxStore.getState().items).toHaveLength(1);
    expect(useOutboxStore.getState().items[0]?.payload.title).toBe('Updated');
  });

  it('marks item in_flight, applied, and failed', () => {
    const item = useOutboxStore.getState().enqueue({
      entityType: 'chat_message',
      action: 'send_message',
      payload: { body: 'Hello' },
      idempotencyKey: 'chat:1:2',
    });

    useOutboxStore.getState().markInFlight(item.id);
    expect(useOutboxStore.getState().items[0]?.status).toBe('in_flight');

    useOutboxStore.getState().markFailed(item.id, {
      code: 'error',
      message: 'Network issue',
      fatal: true,
    });
    expect(useOutboxStore.getState().items[0]?.status).toBe('failed');
    expect(useOutboxStore.getState().items[0]?.lastError?.fatal).toBe(true);

    useOutboxStore.getState().retryItem(item.id);
    expect(useOutboxStore.getState().items[0]?.status).toBe('queued');
    expect(useOutboxStore.getState().items[0]?.attempts).toBe(0);

    useOutboxStore.getState().markApplied(item.id);
    expect(useOutboxStore.getState().items).toHaveLength(0);
  });

  it('increments attempts and transitions to failed on maxAttempts', () => {
    const item = useOutboxStore.getState().enqueue({
      entityType: 'giving_handoff',
      action: 'reserve_item',
      payload: { listingId: 'l1' },
      idempotencyKey: 'handoff:1:2:reserve',
      maxAttempts: 2,
    });

    useOutboxStore.getState().incrementAttempts(item.id);
    expect(useOutboxStore.getState().items[0]?.attempts).toBe(1);
    expect(useOutboxStore.getState().items[0]?.status).toBe('queued');

    useOutboxStore.getState().incrementAttempts(item.id);
    expect(useOutboxStore.getState().items[0]?.attempts).toBe(2);
    expect(useOutboxStore.getState().items[0]?.status).toBe('failed');
  });
});
