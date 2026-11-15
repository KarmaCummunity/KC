import { useMemo } from 'react';
import {
  type LaunchWorldFlagKey,
  type RemoteAppFlags,
  isHubTileLaunchEnabled,
  isMarketplaceWorldLaunchEnabled,
  resolveLaunchWorldEnabled,
  withTesterActiveWorlds,
} from '@kc/domain';
import { isDevEnvironment } from '../config/environment';
import { useAppFlags } from './useAppFlags';

export function useRemoteAppFlags(): RemoteAppFlags | undefined {
  const data = useAppFlags();
  // Tester builds show the housing and knowledge feeds before their remote flag is on (#1630).
  return useMemo(() => (isDevEnvironment() ? withTesterActiveWorlds(data) : data), [data]);
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
