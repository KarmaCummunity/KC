import type { ReactElement, ReactNode } from 'react';
import { Redirect, type Href } from 'expo-router';
import type { LaunchSurface } from '../config/launchSurfaces';
import { useLaunchSurface } from '../hooks/useLaunchSurface';

interface Props {
  surface: LaunchSurface;
  /** Where a hidden surface sends the visitor (a deep link or a stale tab). */
  redirectTo: Href;
  children: ReactNode;
}

/** Renders `children` only while the surface is visible; otherwise redirects. See config/launchSurfaces.ts. */
export function LaunchSurfaceGate({ surface, redirectTo, children }: Props): ReactElement {
  const visible = useLaunchSurface(surface);
  return visible ? <>{children}</> : <Redirect href={redirectTo} />;
}
