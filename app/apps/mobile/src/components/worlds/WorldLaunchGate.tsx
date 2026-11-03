// D60 — a world screen renders in full when its world is active; when its
// launch flag is off it renders the world's portal (links + knowledge) instead.
import React from 'react';
import type { LaunchWorldFlagKey } from '@kc/domain';
import { PORTAL_CATEGORY_BY_FLAG, launchWorldFlagKeyForSlug } from '@kc/domain';
import { useLaunchWorldEnabled, useMarketplaceWorldLaunchEnabled } from '../../hooks/useLaunchWorldFlags';
import { WorldPortalScreen } from './WorldPortalScreen';

export function WorldLaunchGateByFlag({
  flagKey,
  children,
}: {
  readonly flagKey: LaunchWorldFlagKey;
  readonly children: React.ReactNode;
}) {
  const enabled = useLaunchWorldEnabled(flagKey);
  if (!enabled) return <WorldPortalScreen categorySlug={PORTAL_CATEGORY_BY_FLAG[flagKey]} />;
  return <>{children}</>;
}

export function WorldLaunchGateBySlug({
  worldSlug,
  children,
}: {
  readonly worldSlug: string;
  readonly children: React.ReactNode;
}) {
  const flagKey = launchWorldFlagKeyForSlug(worldSlug);
  const enabled = useMarketplaceWorldLaunchEnabled(worldSlug);
  if (flagKey && !enabled) return <WorldPortalScreen categorySlug={PORTAL_CATEGORY_BY_FLAG[flagKey]} />;
  return <>{children}</>;
}
