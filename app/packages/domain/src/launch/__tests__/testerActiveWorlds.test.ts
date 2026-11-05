import { describe, expect, it } from 'vitest';
import {
  TESTER_ACTIVE_WORLD_FLAGS,
  hubTileLaunchMode,
  isMarketplaceWorldLaunchEnabled,
  withTesterActiveWorlds,
} from '../launchWorlds';

describe('tester builds run housing, knowledge and animals as in-app feeds (#1630, #1625)', () => {
  it('lists exactly housing, knowledge and animals', () => {
    expect([...TESTER_ACTIVE_WORLD_FLAGS].sort()).toEqual([
      'world_animals_enabled', 'world_housing_enabled', 'world_knowledge_enabled',
    ]);
  });

  it('turns both worlds on even when the remote flags are off or missing', () => {
    for (const remote of [undefined, {}, { world_housing_enabled: false, world_knowledge_enabled: false }]) {
      const flags = withTesterActiveWorlds(remote);
      expect(isMarketplaceWorldLaunchEnabled('housing', flags)).toBe(true);
      expect(isMarketplaceWorldLaunchEnabled('knowledge', flags)).toBe(true);
      expect(hubTileLaunchMode('housing', flags)).toBe('active');
      expect(hubTileLaunchMode('knowledge', flags)).toBe('active');
    }
  });

  it('leaves every other remote flag untouched', () => {
    const flags = withTesterActiveWorlds({ world_rides_enabled: true, world_money_enabled: false });
    expect(flags['world_rides_enabled']).toBe(true);
    expect(flags['world_money_enabled']).toBe(false);
    expect(hubTileLaunchMode('medical', flags)).toBe('portal');
  });

  it('does not mutate the remote flags it was given', () => {
    const remote = { world_housing_enabled: false };
    withTesterActiveWorlds(remote);
    expect(remote).toEqual({ world_housing_enabled: false });
  });
});
