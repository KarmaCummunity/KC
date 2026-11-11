import { useQuery } from '@tanstack/react-query';
import { type LaunchSurface, resolveLaunchSurface } from '../config/launchSurfaces';
import { fetchRemoteFeatureFlags } from '../services/featureFlagsComposition';

/**
 * Whether a first-launch surface is visible: remote app_flags row, then the EXPO_PUBLIC_LAUNCH_*
 * build override, then the environment default. While the flags load (or offline) the build
 * default applies, so a production build never flashes a hidden surface.
 */
export function useLaunchSurface(surface: LaunchSurface): boolean {
  const { data } = useQuery({
    queryKey: ['app-flags'],
    queryFn: fetchRemoteFeatureFlags,
    staleTime: 5 * 60 * 1000,
  });
  return resolveLaunchSurface(surface, data);
}
