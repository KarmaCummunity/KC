import type { DonationCategorySlug } from '../value-objects';
// Launch wedge (#1041). Remote keys live in public.app_flags as `world_<slug>_enabled`.
// D60 (docs/spec/04_product_structure.md): every world is always shown; the flag
// only picks its mode — `active` (full in-app flow) or `portal` (links + knowledge).

export const LOD_CITY_ID = '7000';

export const LAUNCH_WORLD_FLAG_KEYS = [
  'world_items_enabled',
  'world_food_enabled',
  'world_money_enabled',
  'world_time_enabled',
  'world_rides_enabled',
  'world_knowledge_enabled',
  'world_housing_enabled',
  'world_medical_enabled',
  'world_animals_enabled',
  'world_democracy_enabled',
  'world_employment_enabled',
  'world_challenges_enabled',
  'world_environment_enabled',
  'world_creative_enabled',
  'world_app_design_enabled',
] as const;

export type LaunchWorldFlagKey = (typeof LAUNCH_WORLD_FLAG_KEYS)[number];

/** Compiled defaults when no remote row exists (launch wedge: items + food active). */
export const LAUNCH_WORLD_FLAG_DEFAULTS: Record<LaunchWorldFlagKey, boolean> = {
  world_items_enabled: true,
  world_food_enabled: true,
  world_money_enabled: false,
  world_time_enabled: false,
  world_rides_enabled: false,
  world_knowledge_enabled: false,
  world_housing_enabled: false,
  world_medical_enabled: false,
  world_animals_enabled: false,
  world_democracy_enabled: false,
  world_employment_enabled: false,
  world_challenges_enabled: true,
  world_environment_enabled: false,
  world_creative_enabled: false,
  world_app_design_enabled: false,
};

export type RemoteAppFlags = Partial<Record<string, boolean>>;

/**
 * Worlds whose in-app marketplace feed tester (non-production) builds always show, ahead of the
 * remote flag (#1630, #1625). A production build still follows `app_flags`, so flipping prod stays a
 * separate, owner-approved step.
 */
export const TESTER_ACTIVE_WORLD_FLAGS: readonly LaunchWorldFlagKey[] = [
  'world_housing_enabled',
  'world_knowledge_enabled',
  'world_animals_enabled',
];

export function withTesterActiveWorlds(remote: RemoteAppFlags | undefined): RemoteAppFlags {
  const forced = Object.fromEntries(TESTER_ACTIVE_WORLD_FLAGS.map((key) => [key, true]));
  return { ...remote, ...forced };
}

export function launchWorldFlagKeyForSlug(worldSlug: string): LaunchWorldFlagKey | null {
  const key = `world_${worldSlug}_enabled` as LaunchWorldFlagKey;
  return (LAUNCH_WORLD_FLAG_KEYS as readonly string[]).includes(key) ? key : null;
}

export function resolveLaunchWorldEnabled(
  flagKey: LaunchWorldFlagKey,
  remote: RemoteAppFlags | undefined,
): boolean {
  const value = remote?.[flagKey];
  return typeof value === 'boolean' ? value : LAUNCH_WORLD_FLAG_DEFAULTS[flagKey];
}

export type WorldLaunchMode = 'active' | 'portal';

/** D60 — a world whose flag is off is a portal, never hidden. */
export function launchWorldMode(flagKey: LaunchWorldFlagKey, remote: RemoteAppFlags | undefined): WorldLaunchMode {
  return resolveLaunchWorldEnabled(flagKey, remote) ? 'active' : 'portal';
}

/** Links/knowledge list a portal world shows (FR-DONATE-006 category slugs); items has none yet. */
export const PORTAL_CATEGORY_BY_FLAG: Partial<Record<LaunchWorldFlagKey, DonationCategorySlug>> = {
  world_food_enabled: 'food',
  world_money_enabled: 'money',
  world_time_enabled: 'time',
  world_rides_enabled: 'transport',
  world_knowledge_enabled: 'knowledge',
  world_housing_enabled: 'housing',
  world_medical_enabled: 'medical',
  world_animals_enabled: 'animals',
  world_democracy_enabled: 'democracy',
  world_employment_enabled: 'employment',
  world_challenges_enabled: 'challenges',
};

export function isMarketplaceWorldLaunchEnabled(
  worldSlug: string,
  remote: RemoteAppFlags | undefined,
): boolean {
  const key = launchWorldFlagKeyForSlug(worldSlug);
  return key ? resolveLaunchWorldEnabled(key, remote) : true;
}

/** Donations hub tile keys → launch flag (transport → rides). */
export const HUB_TILE_LAUNCH_FLAG: Record<string, LaunchWorldFlagKey> = {
  items: 'world_items_enabled',
  food: 'world_food_enabled',
  money: 'world_money_enabled',
  time: 'world_time_enabled',
  housing: 'world_housing_enabled',
  transport: 'world_rides_enabled',
  knowledge: 'world_knowledge_enabled',
  medical: 'world_medical_enabled',
  animals: 'world_animals_enabled',
  democracy: 'world_democracy_enabled',
  employment: 'world_employment_enabled',
  challenges: 'world_challenges_enabled',
};

export function hubTileLaunchMode(tileKey: string, remote: RemoteAppFlags | undefined): WorldLaunchMode {
  const flag = HUB_TILE_LAUNCH_FLAG[tileKey];
  return flag ? launchWorldMode(flag, remote) : 'active';
}

export function isHubTileLaunchEnabled(tileKey: string, remote: RemoteAppFlags | undefined): boolean {
  return hubTileLaunchMode(tileKey, remote) === 'active';
}

export function analyticsCitySegment(cityId: string | null | undefined): 'lod' | 'other' {
  return cityId === LOD_CITY_ID ? 'lod' : 'other';
}
