// #2277 (FR-ADMIN-034) — the admin portal's world switch: each giving world with its current mode
// (portal / active) from this environment's launch flags, and the switch that writes the flag.
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ADMIN_SWITCHABLE_WORLDS, launchWorldMode, type LaunchWorldFlagKey, type WorldLaunchMode } from '@kc/domain';
import { getSetWorldLaunchModeUseCase } from '../services/worldLaunchAdminComposition';
import { APP_FLAGS_QUERY_ROOT, useAppFlags } from './useAppFlags';

export interface WorldLaunchRow {
  readonly tileKey: string;
  readonly flagKey: LaunchWorldFlagKey;
  readonly mode: WorldLaunchMode;
}

export function useWorldLaunchAdmin() {
  const remote = useAppFlags();
  const queryClient = useQueryClient();
  // The flag whose write is running, so its row can show a spinner and block a second press.
  const [busyKey, setBusyKey] = useState<LaunchWorldFlagKey | null>(null);

  const worlds: WorldLaunchRow[] = ADMIN_SWITCHABLE_WORLDS.map((world) => ({
    ...world,
    mode: launchWorldMode(world.flagKey, remote),
  }));

  /** Switches one world; resolves false when the server refused it, so the screen can say so. */
  const setMode = useCallback(
    async (flagKey: LaunchWorldFlagKey, mode: WorldLaunchMode): Promise<boolean> => {
      setBusyKey(flagKey);
      try {
        await getSetWorldLaunchModeUseCase().execute({ flagKey, mode });
        // Every screen that gates on a world flag reads this query; refetch it now.
        await queryClient.invalidateQueries({ queryKey: [APP_FLAGS_QUERY_ROOT] });
        return true;
      } catch {
        return false;
      } finally {
        setBusyKey(null);
      }
    },
    [queryClient],
  );

  return { worlds, loaded: remote !== undefined, busyKey, setMode };
}
