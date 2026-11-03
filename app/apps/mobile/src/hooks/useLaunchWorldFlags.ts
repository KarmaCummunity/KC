import { useQuery } from '@tanstack/react-query';
import {
  type LaunchWorldFlagKey,
  type RemoteAppFlags,
  isHubTileLaunchEnabled,
  isMarketplaceWorldLaunchEnabled,
  resolveLaunchWorldEnabled,
} from '@kc/domain';
import { fetchRemoteFeatureFlags } from '../services/featureFlagsComposition';

export function useRemoteAppFlags(): RemoteAppFlags | undefined {
  const { data } = useQuery({
    queryKey: ['app-flags'],
    queryFn: fetchRemoteFeatureFlags,
    staleTime: 5 * 60 * 1000,
  });
  return data;
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
