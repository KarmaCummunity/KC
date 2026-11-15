// D100 (docs/spec/04_product_structure.md): the Donations hub is ONE list of giving worlds, in
// the order of `GIVING_WORLD_SLUGS` (the hub screen re-orders it per member, FR-DONATE-001 AC8). Each tile opens its world's screen; a world with no active
// flow yet (launch flag off, D60) is still listed and is marked as a portal.
import type { Ionicons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import {
  GIVING_WORLD_SLUGS,
  hubTileLaunchMode,
  type GivingWorldSlug,
  type RemoteAppFlags,
  type WorldLaunchMode,
} from '@kc/domain';

export interface DonationHubTile {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  titleKey: string;
  subtitleKey: string;
  href: Extract<Href, string>;
  testID: string;
}

/** World screens that exist as their own route; every other world uses the generic category screen. */
const OWN_ROUTE: Readonly<Partial<Record<GivingWorldSlug, string>>> = {
  items: '/(tabs)/donations/items',
  food: '/(tabs)/donations/food',
  rides: '/(tabs)/donations/rides',
  time: '/(tabs)/donations/time',
  money: '/(tabs)/donations/money',
  housing: '/(tabs)/donations/housing',
  knowledge: '/(tabs)/donations/knowledge',
  animals: '/(tabs)/donations/animals',
  challenges: '/(tabs)/donations/challenges',
};

/**
 * Icon and test id of each world's tile. The test ids are literals (not built from the slug) so
 * the Maestro flow check can find every id a flow taps (`scripts/maestro-flows.test.mjs`).
 */
const TILE_META: Readonly<Record<GivingWorldSlug, { icon: keyof typeof Ionicons.glyphMap; testID: string }>> = {
  items: { icon: 'gift-outline', testID: 'donation-tile-items' },
  food: { icon: 'restaurant-outline', testID: 'donation-tile-food' },
  rides: { icon: 'car-outline', testID: 'donation-tile-rides' },
  time: { icon: 'time-outline', testID: 'donation-tile-time' },
  money: { icon: 'cash-outline', testID: 'donation-tile-money' },
  housing: { icon: 'home-outline', testID: 'donation-tile-housing' },
  knowledge: { icon: 'school-outline', testID: 'donation-tile-knowledge' },
  medical: { icon: 'medical-outline', testID: 'donation-tile-medical' },
  animals: { icon: 'paw-outline', testID: 'donation-tile-animals' },
  democracy: { icon: 'megaphone-outline', testID: 'donation-tile-democracy' },
  employment: { icon: 'briefcase-outline', testID: 'donation-tile-employment' },
  challenges: { icon: 'trophy-outline', testID: 'donation-tile-challenges' },
};

/** i18n key prefix of a world's title / subtitle (a few worlds predate the `categories` group). */
const TEXT_PREFIX: Readonly<Partial<Record<GivingWorldSlug, readonly [string, string]>>> = {
  items: ['donations.items.title', 'donations.items.subtitle'],
  rides: ['donations.rides.hubTitle', 'donations.rides.hubSubtitle'],
  time: ['donations.time.title', 'donations.time.subtitle'],
  money: ['donations.money.title', 'donations.money.subtitle'],
};

/** The screen of a giving world: its own route, or the generic category screen. */
export function givingWorldHref(worldSlug: string): Extract<Href, string> {
  const own = (OWN_ROUTE as Readonly<Record<string, string | undefined>>)[worldSlug];
  return (own ?? `/(tabs)/donations/category/${worldSlug}`) as Extract<Href, string>;
}

function tileFor(world: GivingWorldSlug): DonationHubTile {
  // The rides world keeps its legacy `transport` hub key (launch flag + test ids).
  const key = world === 'rides' ? 'transport' : world;
  const [titleKey, subtitleKey] = TEXT_PREFIX[world] ?? [
    `donations.categories.${world}.title`,
    `donations.categories.${world}.subtitle`,
  ];
  return {
    key,
    icon: TILE_META[world].icon,
    titleKey,
    subtitleKey,
    href: givingWorldHref(world),
    testID: TILE_META[world].testID,
  };
}

export const DONATIONS_HUB_TILES: readonly DonationHubTile[] = GIVING_WORLD_SLUGS.map(tileFor);

/** D60 — the hub always shows every world; flags only set active vs portal. */
export function donationsHubTiles(remote: RemoteAppFlags | undefined): Array<{ tile: DonationHubTile; mode: WorldLaunchMode }> {
  return DONATIONS_HUB_TILES.map((tile) => ({ tile, mode: hubTileLaunchMode(tile.key, remote) }));
}

/** The screen of a giving world, e.g. where to land after adding a link to it. */
export function hubHrefForWorld(world: GivingWorldSlug): DonationHubTile['href'] {
  return tileFor(world).href;
}
