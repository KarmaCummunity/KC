// Mapped to spec: FR-FEED-020, docs/spec/10_challenges.md — the challenges world uses the same
// feed as the other giving worlds. Each challenge is a post of type challenge.
import React from 'react';
import { WorldMarketplaceHub } from '../../../../src/components/giving/WorldMarketplaceHub';
import { WORLD_CHROME_BY_SLUG } from '../../../../src/components/giving/worldChromeRegistry';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function ChallengesWorldScreen() {
  return (
    <WorldMarketplaceHub
      worldSlug="challenges"
      icon="trophy-outline"
      introKey="donations.worldFeed.challengesIntro"
      subScreens={WORLD_CHROME_BY_SLUG.challenges.subScreens}
    />
  );
}
