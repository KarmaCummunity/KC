// Hook for fetching About → Team roster (FR-SETTINGS About). The baseline has no team roster (M08):
// the list then loads as empty (degrade rule) and the section shows no cards and no error.

import { useState, useEffect, useCallback } from 'react';
import type { AboutTeamMember } from '@kc/domain';
import { getListAboutTeamMembersUseCase } from '../services/aboutComposition';
import { listOrEmpty } from '../lib/backendAvailability';

interface TeamState {
  readonly members: AboutTeamMember[];
  readonly loading: boolean;
  readonly error: boolean;
}

export function useAboutTeamMembers(): TeamState & { refetch: () => void } {
  const [state, setState] = useState<TeamState>({
    members: [],
    loading: true,
    error: false,
  });

  const fetch = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const members = await listOrEmpty(() => getListAboutTeamMembersUseCase().execute());
      setState({ members, loading: false, error: false });
    } catch {
      setState((s) => ({ ...s, loading: false, error: true }));
    }
  }, []);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  return { ...state, refetch: fetch };
}
