// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { BackendUnavailableError, type AboutTeamMember } from '@kc/domain';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../services/aboutComposition', () => ({
  getListAboutTeamMembersUseCase: () => ({ execute }),
}));

import { useAboutTeamMembers } from '../useAboutTeamMembers';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('useAboutTeamMembers', () => {
  it('loads members and refetches on request', async () => {
    const members = [{ id: 'member-1' }] as unknown as AboutTeamMember[];
    execute.mockResolvedValue(members);
    const { result } = renderHook(() => useAboutTeamMembers());
    await waitFor(() => expect(result.current).toMatchObject({ members, loading: false, error: false }));
    await act(async () => { result.current.refetch(); });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.current.members).toEqual(members);
  });

  it('retains existing members and exposes error state when a refetch rejects', async () => {
    const members = [{ id: 'member-1' }] as unknown as AboutTeamMember[];
    execute.mockResolvedValueOnce(members).mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useAboutTeamMembers());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { result.current.refetch(); });
    await waitFor(() => expect(result.current).toMatchObject({ members, loading: false, error: true }));
  });

  it('shows an empty roster, not an error, while the backend has no team list (M08)', async () => {
    execute.mockRejectedValue(new BackendUnavailableError('table:about_team_profiles', 'relation'));
    const { result } = renderHook(() => useAboutTeamMembers());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ members: [], error: false });
  });
});
