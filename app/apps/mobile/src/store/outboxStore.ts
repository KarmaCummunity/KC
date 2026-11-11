import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateUuid } from '../lib/uuid';

export type OutboxEntityType = 'post' | 'chat_message' | 'giving_handoff';
export type OutboxAction =
  | 'create_post'
  | 'send_message'
  | 'reserve_item'
  | 'claim_food'
  | 'confirm_handoff';

export type OutboxItemStatus = 'queued' | 'in_flight' | 'failed' | 'applied';

export interface OutboxItemError {
  code: string;
  message: string;
  fatal: boolean;
}

export interface OutboxItem {
  id: string;
  entityType: OutboxEntityType;
  action: OutboxAction;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  createdAt: string;
  attempts: number;
  maxAttempts: number;
  status: OutboxItemStatus;
  lastError?: OutboxItemError;
}

export type EnqueueOutboxInput = Omit<
  OutboxItem,
  'id' | 'createdAt' | 'attempts' | 'status' | 'maxAttempts'
> &
  Partial<Pick<OutboxItem, 'id' | 'createdAt' | 'attempts' | 'status' | 'maxAttempts'>>;

interface OutboxState {
  items: OutboxItem[];
  enqueue: (item: EnqueueOutboxInput) => OutboxItem;
  markInFlight: (id: string) => void;
  markApplied: (id: string) => void;
  markFailed: (id: string, error?: OutboxItemError) => void;
  incrementAttempts: (id: string, error?: OutboxItemError) => void;
  retryItem: (id: string) => void;
  removeItem: (id: string) => void;
  clearAll: () => void;
}

export const useOutboxStore = create<OutboxState>()(
  persist(
    (set) => ({
      items: [],
      enqueue: (data) => {
        const item: OutboxItem = {
          id: data.id ?? generateUuid(),
          entityType: data.entityType,
          action: data.action,
          payload: data.payload,
          idempotencyKey: data.idempotencyKey,
          createdAt: data.createdAt ?? new Date().toISOString(),
          attempts: data.attempts ?? 0,
          maxAttempts: data.maxAttempts ?? 5,
          status: data.status ?? 'queued',
          lastError: data.lastError,
        };
        set((s) => ({
          items: [...s.items.filter((i) => i.idempotencyKey !== item.idempotencyKey), item],
        }));
        return item;
      },
      markInFlight: (id) =>
        set((s) => ({
          items: s.items.map((i) => (i.id === id ? { ...i, status: 'in_flight' } : i)),
        })),
      markApplied: (id) =>
        set((s) => ({
          items: s.items.filter((i) => i.id !== id),
        })),
      markFailed: (id, error) =>
        set((s) => ({
          items: s.items.map((i) =>
            i.id === id ? { ...i, status: 'failed', lastError: error } : i,
          ),
        })),
      incrementAttempts: (id, error) =>
        set((s) => ({
          items: s.items.map((i) => {
            if (i.id !== id) return i;
            const nextAttempts = i.attempts + 1;
            const isFailed = nextAttempts >= i.maxAttempts;
            return {
              ...i,
              attempts: nextAttempts,
              status: isFailed ? 'failed' : 'queued',
              lastError: error ?? i.lastError,
            };
          }),
        })),
      retryItem: (id) =>
        set((s) => ({
          items: s.items.map((i) =>
            i.id === id ? { ...i, status: 'queued', attempts: 0, lastError: undefined } : i,
          ),
        })),
      removeItem: (id) =>
        set((s) => ({
          items: s.items.filter((i) => i.id !== id),
        })),
      clearAll: () => set({ items: [] }),
    }),
    {
      name: 'kc-sync-outbox',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ items: s.items }),
    },
  ),
);
