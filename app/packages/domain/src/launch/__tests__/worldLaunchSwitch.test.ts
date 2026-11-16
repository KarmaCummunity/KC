import { describe, expect, it } from 'vitest';
import {
  ADMIN_SWITCHABLE_WORLDS,
  hubTileLaunchMode,
  isAdminSwitchableWorldFlag,
  isMarketplaceWorldLaunchEnabled,
} from '../launchWorlds';

// #2277 reverses #1630 / #1625: tester builds no longer force housing, knowledge and animals on.
// The remote flag, switched by the super admin per environment, is the one source in every build.
describe('a world follows its remote launch flag in every build (#2277)', () => {
  it('runs housing, knowledge and animals as portals while their flags are off or missing', () => {
    for (const remote of [undefined, {}, { world_housing_enabled: false, world_knowledge_enabled: false }]) {
      expect(isMarketplaceWorldLaunchEnabled('housing', remote)).toBe(false);
      expect(isMarketplaceWorldLaunchEnabled('knowledge', remote)).toBe(false);
      expect(hubTileLaunchMode('housing', remote)).toBe('portal');
      expect(hubTileLaunchMode('animals', remote)).toBe('portal');
    }
  });

  it('runs them as active worlds once their flags are on', () => {
    const remote = { world_housing_enabled: true, world_knowledge_enabled: true, world_animals_enabled: true };
    expect(isMarketplaceWorldLaunchEnabled('housing', remote)).toBe(true);
    expect(isMarketplaceWorldLaunchEnabled('knowledge', remote)).toBe(true);
    expect(hubTileLaunchMode('animals', remote)).toBe('active');
  });

  it('leaves every other remote flag as it is', () => {
    expect(hubTileLaunchMode('medical', { world_rides_enabled: true })).toBe('portal');
    expect(hubTileLaunchMode('transport', { world_rides_enabled: true })).toBe('active');
  });
});

describe('the worlds the admin portal switches (#2277)', () => {
  it('are the twelve giving worlds, each with its own flag', () => {
    expect(ADMIN_SWITCHABLE_WORLDS.map((w) => w.tileKey).sort()).toEqual([
      'animals', 'challenges', 'democracy', 'employment', 'food', 'housing',
      'items', 'knowledge', 'medical', 'money', 'time', 'transport',
    ]);
    expect(new Set(ADMIN_SWITCHABLE_WORLDS.map((w) => w.flagKey)).size).toBe(12);
  });

  it('accepts only their flags', () => {
    expect(isAdminSwitchableWorldFlag('world_rides_enabled')).toBe(true);
    expect(isAdminSwitchableWorldFlag('world_creative_enabled')).toBe(false);
    expect(isAdminSwitchableWorldFlag('pro_paywall')).toBe(false);
  });
});
