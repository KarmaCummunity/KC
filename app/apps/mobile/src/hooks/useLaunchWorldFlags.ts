import {
  type LaunchWorldFlagKey,
  type RemoteAppFlags,
  isHubTileLaunchEnabled,
  isMarketplaceWorldLaunchEnabled,
  resolveLaunchWorldEnabled,
} from '@kc/domain';
import { useAppFlags } from './useAppFlags';

/**
 * This environment's launch flags. Every build follows them as they are: the super admin switches a
 * world per environment from the admin portal (#2277), which replaced the tester-build override.
 */
export function useRemoteAppFlags(): RemoteAppFlags | undefined {
  return useAppFlags();
}

export function useLaunchWorldEnabled(flagKey: LaunchWorldFlagKey): boolean {
  const remote = useRemoteAppFlags();
  return resolveLaunchWorldEnabled(flagKey, remote);
}

export function useMarketplaceWorldLaunchEnabled(worldSlug: string): boolean {
  const remote = useRemoteAppFlags();
  return isMarketplaceWorldLaunchEnabled(worldSlug, remote);
}

export function useHubTileLaunchEnabled(tileKey: string): boolean {
  const remote = useRemoteAppFlags();
  return isHubTileLaunchEnabled(tileKey, remote);
}
