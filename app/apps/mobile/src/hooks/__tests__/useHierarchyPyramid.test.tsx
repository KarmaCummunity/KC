// @vitest-environment jsdom
// FR-ADMIN-028 — snapshot cache scope and the lost-access refresh of the layers view.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { OrgHierarchyError, type HierarchySnapshot } from '@kc/domain';

// vi.mock factories are hoisted above imports, so their spies must be hoisted too.
const { session, getHierarchySnapshot } = vi.hoisted(() => ({
  session: { current: { userId: 'u1' } as { userId: string } | null },
  getHierarchySnapshot: vi.fn<() => Promise<HierarchySnapshot>>(),
}));

vi.mock('../../lib/container', () => ({
  container: { getHierarchySnapshot: { execute: getHierarchySnapshot } },
}));
vi.mock('../../store/authStore', () => ({
  useAuthStore: (sel: (s: { session: { userId: string } | null }) => unknown) => sel({ session: session.current }),
}));

import { useHierarchyPyramid } from '../useHierarchyPyramid';

const SNAPSHOT: HierarchySnapshot = {
  members: [],
  census: { communityTotal: 10, roleHolderTotal: 0, orgs: [] },
};

let client: QueryClient;

function renderPyramid() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useHierarchyPyramid(null), { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  session.current = { userId: 'u1' };
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  client.clear();
});

describe('useHierarchyPyramid', () => {
  it('never serves a snapshot cached for another signed-in user', async () => {
    getHierarchySnapshot.mockResolvedValue(SNAPSHOT);
    const { result, rerender } = renderPyramid();
    await waitFor(() => expect(result.current.pyramid).not.toBeNull());
    // The session switches to another admin whose own snapshot has not arrived yet.
    session.current = { userId: 'u2' };
    getHierarchySnapshot.mockReturnValue(new Promise(() => {}));
    rerender();
    expect(result.current.pyramid).toBeNull();
  });

  it('refreshes the admin roles when the snapshot is forbidden', async () => {
    getHierarchySnapshot.mockRejectedValue(new OrgHierarchyError('forbidden'));
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    renderPyramid();
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin.roles'] }));
  });

  it('keeps the admin roles cached on any other failure', async () => {
    getHierarchySnapshot.mockRejectedValue(new OrgHierarchyError('unknown'));
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderPyramid();
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(invalidate).not.toHaveBeenCalled();
  });
});
