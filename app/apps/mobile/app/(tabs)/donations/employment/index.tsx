// Mapped to spec: FR-FEED-020 AC2 / AC3 — the employment world screen (#2278): offer a job or look
// for work, search, and the world's feed of job offers and job requests. While the employment
// launch flag is off the world stays a portal (curated links, D60); the super admin switches it
// per environment from the admin portal.
import React from 'react';
import { WorldMarketplaceHub } from '../../../../src/components/giving/WorldMarketplaceHub';
import { WORLD_CHROME_BY_SLUG } from '../../../../src/components/giving/worldChromeRegistry';
import { WorldLaunchGateBySlug } from '../../../../src/components/worlds/WorldLaunchGate';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function EmploymentWorldScreen() {
  return (
    <WorldLaunchGateBySlug worldSlug="employment">
      <WorldMarketplaceHub
        worldSlug="employment"
        icon="briefcase-outline"
        introKey="donations.worldFeed.employmentIntro"
        subScreens={WORLD_CHROME_BY_SLUG.employment.subScreens}
      />
    </WorldLaunchGateBySlug>
  );
}
