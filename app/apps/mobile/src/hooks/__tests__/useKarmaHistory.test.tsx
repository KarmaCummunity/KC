// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';

const { from, select, eq, order, limit } = vi.hoisted(() => {
  const chain = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn() };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  return { ...chain, from: vi.fn(() => chain) };
});
vi.mock('@kc/infrastructure-supabase', async () => {
  const { BackendUnavailableError: Unavailable } = await import('@kc/domain');
  return {
    getSupabaseClient: () => ({ from }),
    unwrapCall: (object: string, result: { data: unknown; error: { code?: string } | null }) => {
      if (result.error?.code === 'PGRST205') throw new Unavailable(object, 'relation');
      if (result.error) throw result.error;
      return result.data;
    },
  };
});

import { useKarmaHistory, karmaReasonKey } from '../useKarmaHistory';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('useKarmaHistory', () => {
  it('loads the newest ledger rows with the bounded ordered query and maps the public shape', async () => {
    limit.mockResolvedValue({ data: [{ id: 9, event_type: 'handoff_giver', points: 20, created_at: '2025-01-02' }], error: null });
    const { result } = renderHook(() => useKarmaHistory('u1'), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([{ id: 9, eventType: 'handoff_giver', delta: 20, createdAt: '2025-01-02' }]));
    expect(from).toHaveBeenCalledWith('karma_ledger');
    expect(select).toHaveBeenCalledWith('id, event_type, points, created_at');
    expect(eq).toHaveBeenCalledWith('user_id', 'u1');
    expect(order).toHaveBeenNthCalledWith(1, 'created_at', { ascending: false });
    expect(order).toHaveBeenNthCalledWith(2, 'id', { ascending: false });
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

  it('exposes a query failure and a missing ledger as errors', async () => {
    const failure = { message: 'offline' };
    limit.mockResolvedValue({ data: null, error: failure });
    const { result } = renderHook(() => useKarmaHistory('u3'), { wrapper });
    await waitFor(() => expect(result.current.error).toBe(failure));
    limit.mockResolvedValue({ data: null, error: { code: 'PGRST205' } });
    const missing = renderHook(() => useKarmaHistory('u4'), { wrapper });
    await waitFor(() => expect(missing.result.current.error).toBeInstanceOf(BackendUnavailableError));
  });
});

describe('karmaReasonKey', () => {
  it('maps the baseline handoff awards to their labels and unknown events to other', () => {
    expect(karmaReasonKey('handoff_giver')).toBe('giving_handoff_giver');
    expect(karmaReasonKey('handoff_receiver')).toBe('giving_handoff_receiver');
    expect(karmaReasonKey('unrecognized')).toBe('other');
    expect(karmaReasonKey('registration')).toBe('registration');
  });
});
