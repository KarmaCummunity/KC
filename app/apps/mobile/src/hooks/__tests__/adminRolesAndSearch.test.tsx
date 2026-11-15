// @vitest-environment jsdom
// P4 hooks on the baseline: the staff roles degrade to "no roles" when `get_my_admin_roles` is
// not deployed (so the portal stays hidden), the super-admin flag derives from those roles, and
// the keyset-paged admin searches follow `nextCursor` and read an unavailable backend as empty.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BackendUnavailableError } from '@kc/domain';

const m = vi.hoisted(() => ({
  roles: vi.fn(),
  searchUsers: vi.fn(),
}));

vi.mock('../../lib/container', () => ({
  container: {
    getMyAdminRoles: { execute: m.roles },
    adminSearchUsers: { execute: m.searchUsers },
    adminSearchPosts: { execute: vi.fn() },
    adminSearchAudit: { execute: vi.fn() },
  },
}));
vi.mock('../../lib/backendAvailability', async () => {
  const { BackendUnavailableError: Unavailable } = await import('@kc/domain');
  const isUnavailable = (error: unknown) => error instanceof Unavailable;
  return {
    listOrEmpty: async (load: () => Promise<unknown[]>) => {
      try { return await load(); } catch (e) { if (isUnavailable(e)) return []; throw e; }
    },
    valueOrNull: async (load: () => Promise<unknown>) => {
      try { return await load(); } catch (e) { if (isUnavailable(e)) return null; throw e; }
    },
  };
});
vi.mock('../../store/authStore', () => ({
  useAuthStore: (select: (s: { session: { userId: string } }) => unknown) => select({ session: { userId: 'me' } }),
}));

import { useAdminRoles } from '../useAdminRoles';
import { useIsSuperAdmin } from '../useIsSuperAdmin';
import { useAdminUserSearch } from '../useAdminContentSearch';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const userRow = (id: string) => ({
  userId: id, displayName: id, shareHandle: id, accountStatus: 'active', cityId: null, createdAt: new Date(),
});

describe('useAdminRoles / useIsSuperAdmin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads the caller\'s staff roles and derives the super-admin flag from them', async () => {
    m.roles.mockResolvedValue(['super_admin', 'moderator']);
    const { result } = renderHook(() => ({ roles: useAdminRoles(), superAdmin: useIsSuperAdmin() }), { wrapper });
    await waitFor(() => expect(result.current.roles.isLoading).toBe(false));
    expect(result.current.roles.roles).toEqual(['super_admin', 'moderator']);
    expect(result.current.superAdmin).toBe(true);
  });

  it('is not a super admin with other roles, nor while the roles load', async () => {
    m.roles.mockResolvedValue(['moderator']);
    const { result } = renderHook(() => useIsSuperAdmin(), { wrapper });
    expect(result.current).toBe(false);
    await waitFor(() => expect(m.roles).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it('reads an unavailable get_my_admin_roles as no roles (the portal stays hidden)', async () => {
    m.roles.mockRejectedValue(new BackendUnavailableError('rpc:get_my_admin_roles', 'function'));
    const { result } = renderHook(() => useAdminRoles(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.roles).toEqual([]);
  });
});

describe('useAdminUserSearch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('follows nextCursor for the next page and stops when it is null', async () => {
    m.searchUsers
      .mockResolvedValueOnce({ rows: [userRow('u1')], nextCursor: { createdAt: 't1', id: 'u1' } })
      .mockResolvedValueOnce({ rows: [userRow('u2')], nextCursor: null });
    const { result } = renderHook(() => useAdminUserSearch({ query: 'a' }), { wrapper });
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(result.current.hasMore).toBe(true);
    expect(m.searchUsers).toHaveBeenLastCalledWith({ query: 'a', cursor: null });

    act(() => result.current.fetchMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(m.searchUsers).toHaveBeenLastCalledWith({ query: 'a', cursor: { createdAt: 't1', id: 'u1' } });
    expect(result.current.hasMore).toBe(false);
  });

  it('reads an unavailable backend as an empty result', async () => {
    m.searchUsers.mockRejectedValue(new BackendUnavailableError('table:users', 'relation'));
    const { result } = renderHook(() => useAdminUserSearch({}), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.rows).toEqual([]);
    expect(result.current.hasMore).toBe(false);
  });
});
