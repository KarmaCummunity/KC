import { type LaunchSurface, resolveLaunchSurface } from '../config/launchSurfaces';
import { useAppFlags } from './useAppFlags';

/**
 * Whether a first-launch surface is visible: remote app_flags row, then the EXPO_PUBLIC_LAUNCH_*
 * build override, then the environment default. The flags are members-only, so before sign-in (the
 * welcome screen) and while they load or offline the build default applies, and a production build
 * never flashes a hidden surface.
 */
export function useLaunchSurface(surface: LaunchSurface): boolean {
  return resolveLaunchSurface(surface, useAppFlags());
}
