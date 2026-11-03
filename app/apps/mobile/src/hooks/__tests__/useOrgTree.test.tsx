// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { OrgTreeNode } from '@kc/domain';
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../lib/container', () => ({ container: { getOrgTree: { execute } } }));
import { useOrgTree } from '../useOrgTree';
let client: QueryClient;
function renderTree(orgId: string | null, enabled = true) { const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>; return renderHook(() => useOrgTree(orgId, enabled), { wrapper }); }
beforeEach(() => { vi.clearAllMocks(); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
afterEach(() => { cleanup(); client.clear(); });
const forest = [{ member: { userId: 'u1' }, children: [{ member: { userId: 'u2' }, children: [] }] }] as unknown as OrgTreeNode[];
describe('useOrgTree', () => {
 it('fetches enabled org and flattens members parent first', async () => { execute.mockResolvedValue(forest); const { result } = renderTree('org-1'); await waitFor(() => expect(result.current.isLoading).toBe(false)); expect(execute).toHaveBeenCalledWith({ orgId: 'org-1' }); expect(result.current.forest).toBe(forest); expect(result.current.members.map((m) => m.userId)).toEqual(['u1', 'u2']); expect(result.current.error).toBeNull(); });
 it('does not fetch when disabled and exposes query failures and refetch', async () => { execute.mockRejectedValue(new Error('offline')); const { result } = renderTree('org-2', false); expect(execute).not.toHaveBeenCalled(); result.current.refetch(); await waitFor(() => expect(execute).toHaveBeenCalledTimes(1)); cleanup(); execute.mockClear(); const failed = renderTree('org-2'); await waitFor(() => expect(failed.result.current.error).toBeInstanceOf(Error)); failed.result.current.refetch(); await waitFor(() => expect(execute).toHaveBeenCalledTimes(2)); });
});
