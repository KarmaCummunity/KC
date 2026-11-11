// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { from, select, eq, order, limit } = vi.hoisted(() => {
  const chain = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn() };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  return { ...chain, from: vi.fn(() => chain) };
});
vi.mock('@kc/infrastructure-supabase', () => ({ getLegacySupabaseClient: () => ({ from }) }));

import { useKarmaHistory, karmaReasonKey } from '../useKarmaHistory';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.clearAllMocks();
  select.mockReturnValue({ eq }); eq.mockReturnValue({ order }); order.mockReturnValue({ order: vi.fn().mockReturnValue({ limit }) });
});
afterEach(cleanup);

describe('useKarmaHistory', () => {
  it('loads newest rows with the bounded ordered query and maps the public shape', async () => {
    const secondOrder = vi.fn().mockReturnValue({ limit });
    select.mockReturnValue({ eq }); eq.mockReturnValue({ order }); order.mockReturnValue({ order: secondOrder });
    limit.mockResolvedValue({ data: [{ ledger_id: 9, event_type: 'post_created', points_delta: 3, created_at: '2025-01-02' }], error: null });
    const { result } = renderHook(() => useKarmaHistory('u1'), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([{ id: 9, eventType: 'post_created', delta: 3, createdAt: '2025-01-02' }]));
    expect(from).toHaveBeenCalledWith('karma_ledger');
    expect(select).toHaveBeenCalledWith('ledger_id, event_type, points_delta, created_at');
    expect(eq).toHaveBeenCalledWith('user_id', 'u1');
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(secondOrder).toHaveBeenCalledWith('ledger_id', { ascending: false });
    expect(limit).toHaveBeenCalledWith(300);
  });

  it('does not query without a user and maps empty data to an empty list', async () => {
    const noUser = renderHook(() => useKarmaHistory(undefined), { wrapper });
    expect(noUser.result.current.fetchStatus).toBe('idle');
    expect(from).not.toHaveBeenCalled();
    limit.mockResolvedValue({ data: null, error: null });
    const signedIn = renderHook(() => useKarmaHistory('u2'), { wrapper });
    await waitFor(() => expect(signedIn.result.current.data).toEqual([]));
  });

  it('exposes query errors and maps unknown event keys to other', async () => {
    const failure = { message: 'offline' };
    limit.mockResolvedValue({ data: null, error: failure });
    const { result } = renderHook(() => useKarmaHistory('u3'), { wrapper });
    await waitFor(() => expect(result.current.error).toBe(failure));
    expect(karmaReasonKey('unrecognized')).toBe('other');
    expect(karmaReasonKey('registration')).toBe('registration');
  });
});
