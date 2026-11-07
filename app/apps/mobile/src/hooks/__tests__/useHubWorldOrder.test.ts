// @vitest-environment jsdom
// FR-DONATE-001 AC8 — hub order: active worlds first, then portals, each by stored visits.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const store = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void store.set(k, v)),
  },
}));
const focus = vi.hoisted(() => ({ run: null as null | (() => void) }));
vi.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => {
    focus.run = cb;
  },
}));
vi.mock('../../store/authStore', () => ({
  useAuthStore: (sel: (s: { session: { userId: string } }) => unknown) => sel({ session: { userId: 'u1' } }),
}));

import { useHubWorldOrder, worldAffinityKey } from '../useHubWorldOrder';

const tiles = [
  { key: 'items' },
  { key: 'money', portal: true },
  { key: 'food' },
  { key: 'medical', portal: true },
];
const keys = (r: { current: { ordered: { key: string }[] } }) => r.current.ordered.map((t) => t.key);

afterEach(() => {
  cleanup();
  store.clear();
});

describe('useHubWorldOrder', () => {
  it('starts with active worlds first in the canonical order', () => {
    const { result } = renderHook(() => useHubWorldOrder(tiles));
    expect(keys(result)).toEqual(['items', 'food', 'money', 'medical']);
  });

  it('orders by stored visits once loaded', async () => {
    store.set(worldAffinityKey('u1'), JSON.stringify({ food: { score: 3, at: Date.now() }, medical: { score: 1, at: Date.now() } }));
    const { result } = renderHook(() => useHubWorldOrder(tiles));
    await waitFor(() => expect(keys(result)).toEqual(['food', 'items', 'medical', 'money']));
  });

  it('records a visit without reordering until the screen regains focus', async () => {
    const { result } = renderHook(() => useHubWorldOrder(tiles));
    await waitFor(() => expect(store.size).toBe(0));

    act(() => result.current.recordOpen('food'));
    expect(keys(result)).toEqual(['items', 'food', 'money', 'medical']);
    expect(JSON.parse(store.get(worldAffinityKey('u1'))!).food.score).toBe(1);

    act(() => focus.run?.());
    expect(keys(result)).toEqual(['food', 'items', 'money', 'medical']);
  });
});
