import { describe, expect, it } from 'vitest';
import { resolveActiveWorldMenuItem, screenLabelKeyForMenuItem, WORLD_MAP_MENU_ID } from '../worldMenuActive';
import { worldSubScreens } from '../worldSubScreens';

const timeSubs = worldSubScreens('/(tabs)/donations/time/handoffs', [
  { labelKey: 'timeVolunteer.myShiftsLink', path: '/(tabs)/donations/time/my-shifts', testID: 'time-my-shifts' },
  { labelKey: 'timeVolunteer.organizerLink', path: '/(tabs)/donations/time/organizer', testID: 'time-organizer' },
]);

describe('resolveActiveWorldMenuItem', () => {
  it('marks feed on the world index route', () => {
    expect(
      resolveActiveWorldMenuItem({
        pathname: '/donations/time',
        worldSlug: 'time',
        feedPath: '/(tabs)/donations/time',
        subScreens: timeSubs,
      }),
    ).toBe('world-menu-feed');
  });

  it('marks handoffs, not feed', () => {
    expect(
      resolveActiveWorldMenuItem({
        pathname: '/donations/time/handoffs',
        worldSlug: 'time',
        feedPath: '/(tabs)/donations/time',
        subScreens: timeSubs,
      }),
    ).toBe('world-hub-my-handoffs');
  });

  it('marks my-listings only with matching world query', () => {
    expect(
      resolveActiveWorldMenuItem({
        pathname: '/donations/marketplace/my-listings',
        worldQuery: 'time',
        worldSlug: 'time',
        feedPath: '/(tabs)/donations/time',
        subScreens: timeSubs,
      }),
    ).toBe('world-hub-my-listings');
    expect(
      resolveActiveWorldMenuItem({
        pathname: '/donations/marketplace/my-listings',
        worldQuery: 'housing',
        worldSlug: 'time',
        feedPath: '/(tabs)/donations/time',
        subScreens: timeSubs,
      }),
    ).toBeNull();
  });

  it('marks nested organizer route', () => {
    expect(
      resolveActiveWorldMenuItem({
        pathname: '/donations/time/organizer/opp-1',
        worldSlug: 'time',
        feedPath: '/(tabs)/donations/time',
        subScreens: timeSubs,
      }),
    ).toBe('time-organizer');
  });

  it('marks world-scoped map for title', () => {
    expect(
      resolveActiveWorldMenuItem({
        pathname: '/donations/marketplace/map',
        worldQuery: 'time',
        worldSlug: 'time',
        feedPath: '/(tabs)/donations/time',
        subScreens: timeSubs,
      }),
    ).toBe(WORLD_MAP_MENU_ID);
  });
});

describe('screenLabelKeyForMenuItem', () => {
  it('resolves feed and listing keys', () => {
    expect(screenLabelKeyForMenuItem('world-menu-feed', timeSubs)).toBe('donations.worldFeed.feedTab');
    expect(screenLabelKeyForMenuItem('world-hub-my-listings', timeSubs)).toBe('marketplace.myListingsNav');
  });
});
