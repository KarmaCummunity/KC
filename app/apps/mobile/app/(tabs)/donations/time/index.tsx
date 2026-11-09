// Mapped to spec: FR-FEED-020 AC2 / AC3 — the time world screen: request / offer, the world's
// own screens (shifts, organizer tools, contact), the organisations' volunteering
// opportunities, then search and the members' feed of open time offers and requests. While
// the time launch flag is off the world stays a portal (D60).
import React from 'react';
import { WorldMarketplaceHub } from '../../../../src/components/giving/WorldMarketplaceHub';
import { WORLD_CHROME_BY_SLUG } from '../../../../src/components/giving/worldChromeRegistry';
import { TimeOpportunitiesSection } from '../../../../src/components/giving/time/TimeOpportunitiesSection';
import { WorldLaunchGateByFlag } from '../../../../src/components/worlds/WorldLaunchGate';

export default function TimeWorldScreen() {
  return (
    <WorldLaunchGateByFlag flagKey="world_time_enabled">
      <WorldMarketplaceHub
        worldSlug="time"
        icon="time-outline"
        introKey="timeVolunteer.hubIntro"
        linksCategory="time"
        subScreens={WORLD_CHROME_BY_SLUG.time.subScreens}
        headerExtra={<TimeOpportunitiesSection />}
      />
    </WorldLaunchGateByFlag>
  );
}
