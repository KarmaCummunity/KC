// Mapped to spec: FR-FEED-020 AC2 / AC3 — the time world screen: request / offer, the world's
// own screens (shifts, organizer tools, contact), the organisations' volunteering
// opportunities, then search and the members' feed of open time offers and requests. While
// the time launch flag is off the world stays a portal (D60).
import React from 'react';
import { WorldMarketplaceHub } from '../../../../src/components/giving/WorldMarketplaceHub';
import { worldSubScreens } from '../../../../src/components/giving/worldSubScreens';
import { TimeOpportunitiesSection } from '../../../../src/components/giving/time/TimeOpportunitiesSection';
import { WorldLaunchGateByFlag } from '../../../../src/components/worlds/WorldLaunchGate';

const TIME_SUB_SCREENS = worldSubScreens('/(tabs)/donations/time/handoffs', [
  { labelKey: 'timeVolunteer.myShiftsLink', path: '/(tabs)/donations/time/my-shifts', testID: 'time-my-shifts' },
  { labelKey: 'timeVolunteer.organizerLink', path: '/(tabs)/donations/time/organizer', testID: 'time-organizer' },
  { labelKey: 'timeVolunteer.contactKcLink', path: '/(tabs)/donations/time/support', testID: 'time-contact-kc' },
]);

export default function TimeWorldScreen() {
  return (
    <WorldLaunchGateByFlag flagKey="world_time_enabled">
      <WorldMarketplaceHub
        worldSlug="time"
        icon="time-outline"
        introKey="timeVolunteer.hubIntro"
        linksCategory="time"
        subScreens={TIME_SUB_SCREENS}
        headerExtra={<TimeOpportunitiesSection />}
      />
    </WorldLaunchGateByFlag>
  );
}
