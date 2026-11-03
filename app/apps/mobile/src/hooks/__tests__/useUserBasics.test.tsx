// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { findById } = vi.hoisted(() => ({ findById: vi.fn() }));
vi.mock('../../services/userComposition', () => ({ getUserRepo: () => ({ findById }) }));
import { useUserBasics } from '../useUserBasics';

let client: QueryClient;
function renderBasics(userId: string | undefined, enabled = true) {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useUserBasics(userId, enabled), { wrapper });
}
beforeEach(() => { vi.clearAllMocks(); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
afterEach(() => { client.clear(); });

describe('useUserBasics', () => {
  it('maps a found user to the minimal basics record', async () => {
    findById.mockResolvedValue({ userId: 'u1', displayName: 'Alex', avatarUrl: 'avatar.png', email: 'private@example.test' });
    const { result } = renderBasics('u1');
    await waitFor(() => expect(result.current.data).toEqual({ userId: 'u1', displayName: 'Alex', avatarUrl: 'avatar.png' }));
    expect(findById).toHaveBeenCalledWith('u1');
    expect(client.getQueryState(['admin.user.basics', 'u1'])).toBeDefined();
  });

  it('returns null when no user record is found', async () => {
    findById.mockResolvedValue(null);
    const { result } = renderBasics('u1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('skips fetching when the id is missing or explicitly disabled', () => {
    renderBasics(undefined);
    renderBasics('u1', false);
    expect(findById).not.toHaveBeenCalled();
  });

  it('exposes repository rejections as errors', async () => {
    findById.mockRejectedValue(new Error('offline'));
    const { result } = renderBasics('u1');
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
