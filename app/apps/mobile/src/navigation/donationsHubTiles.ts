// D100 (docs/spec/04_product_structure.md): the Donations hub is ONE list of giving worlds, in
// the order of `GIVING_WORLD_SLUGS`. Each tile opens its world's screen; a world with no active
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
};

const ICON: Readonly<Record<GivingWorldSlug, keyof typeof Ionicons.glyphMap>> = {
  items: 'gift-outline',
  food: 'restaurant-outline',
  rides: 'car-outline',
  time: 'time-outline',
  money: 'cash-outline',
  housing: 'home-outline',
  knowledge: 'school-outline',
  medical: 'medical-outline',
  animals: 'paw-outline',
  democracy: 'megaphone-outline',
  employment: 'briefcase-outline',
  challenges: 'trophy-outline',
};

/** i18n key prefix of a world's title / subtitle (a few worlds predate the `categories` group). */
const TEXT_PREFIX: Readonly<Partial<Record<GivingWorldSlug, readonly [string, string]>>> = {
  items: ['donations.items.title', 'donations.items.subtitle'],
  rides: ['donations.rides.hubTitle', 'donations.rides.hubSubtitle'],
  time: ['donations.time.title', 'donations.time.subtitle'],
  money: ['donations.money.title', 'donations.money.subtitle'],
};

function tileFor(world: GivingWorldSlug): DonationHubTile {
  // The rides world keeps its legacy `transport` hub key (launch flag + test ids).
  const key = world === 'rides' ? 'transport' : world;
  const [titleKey, subtitleKey] = TEXT_PREFIX[world] ?? [
    `donations.categories.${world}.title`,
    `donations.categories.${world}.subtitle`,
  ];
  return {
    key,
    icon: ICON[world],
    titleKey,
    subtitleKey,
    href: (OWN_ROUTE[world] ?? `/(tabs)/donations/category/${world}`) as DonationHubTile['href'],
    testID: `donation-tile-${world === 'rides' ? 'rides' : world}`,
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
