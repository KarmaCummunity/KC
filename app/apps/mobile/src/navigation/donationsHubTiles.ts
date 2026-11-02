import type { Ionicons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { DOMAIN_SLUGS, hubTileLaunchMode, type DomainSlug, type RemoteAppFlags, type WorldLaunchMode } from '@kc/domain';

export interface DonationHubTile {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  titleKey: string;
  subtitleKey: string;
  href: Extract<Href, string>;
  testID: string;
}

export const DONATIONS_HUB_FEATURED: DonationHubTile = {
  key: 'items',
  icon: 'gift',
  titleKey: 'donations.hubItemsFeaturedTitle',
  subtitleKey: 'donations.hubItemsFeaturedSubtitle',
  href: '/(tabs)',
  testID: 'donation-tile-items',
};

export const DONATIONS_HUB_TILES: DonationHubTile[] = [
  { key: 'time', icon: 'time-outline', titleKey: 'donations.time.title', subtitleKey: 'donations.time.subtitle', href: '/(tabs)/donations/time', testID: 'donation-tile-time' },
  { key: 'money', icon: 'cash-outline', titleKey: 'donations.money.title', subtitleKey: 'donations.money.subtitle', href: '/(tabs)/donations/money', testID: 'donation-tile-money' },
  { key: 'food', icon: 'restaurant-outline', titleKey: 'donations.categories.food.title', subtitleKey: 'donations.categories.food.subtitle', href: '/(tabs)/donations/food', testID: 'donation-tile-food' },
  { key: 'housing', icon: 'home-outline', titleKey: 'donations.categories.housing.title', subtitleKey: 'donations.categories.housing.subtitle', href: '/(tabs)/donations/housing', testID: 'donation-tile-housing' },
  { key: 'transport', icon: 'car-outline', titleKey: 'donations.rides.hubTitle', subtitleKey: 'donations.rides.hubSubtitle', href: '/(tabs)/donations/rides', testID: 'donation-tile-rides' },
  { key: 'knowledge', icon: 'school-outline', titleKey: 'donations.categories.knowledge.title', subtitleKey: 'donations.categories.knowledge.subtitle', href: '/(tabs)/donations/knowledge', testID: 'donation-tile-knowledge' },
  { key: 'experiences', icon: 'ticket-outline', titleKey: 'donations.worldsHub.experiences.title', subtitleKey: 'donations.worldsHub.experiences.subtitle', href: '/(tabs)/donations/experiences', testID: 'donation-tile-experiences' },
];

/** D60 — the Donations hub always shows every world; flags only set active vs portal. */
export function donationsHubTiles(remote: RemoteAppFlags | undefined): Array<{ tile: DonationHubTile; mode: WorldLaunchMode }> {
  return DONATIONS_HUB_TILES.map((tile) => ({ tile, mode: hubTileLaunchMode(tile.key, remote) }));
}

/** Hub tile key → giving world slug (D62); the rides tile keeps its legacy key. */
const TILE_WORLD: Record<string, string> = { transport: 'rides' };

/** Giving worlds the hub offers: the featured items card plus the world tiles. */
export function hubWorldSlugs(): string[] {
  return [DONATIONS_HUB_FEATURED.key, ...DONATIONS_HUB_TILES.map((t) => TILE_WORLD[t.key] ?? t.key)];
}

const DOMAIN_ICONS: Record<DomainSlug, keyof typeof Ionicons.glyphMap> = {
  medical: 'medical-outline',
  animals: 'paw-outline',
  environment: 'leaf-outline',
  elderly: 'people-outline',
  democracy: 'megaphone-outline',
  employment: 'briefcase-outline',
  sport: 'football-outline',
  tech: 'hardware-chip-outline',
  heritage: 'library-outline',
  culture: 'color-palette-outline',
  spirituality: 'flower-outline',
};

/** D62 — one tile per domain (spec 06), each opening its own domain screen. */
export const DONATIONS_HUB_DOMAIN_TILES: DonationHubTile[] = DOMAIN_SLUGS.map((slug) => ({
  key: slug,
  icon: DOMAIN_ICONS[slug],
  titleKey: `donations.worldsHub.domains.${slug}.title`,
  subtitleKey: `donations.worldsHub.domains.${slug}.subtitle`,
  href: `/(tabs)/donations/domain/${slug}`,
  testID: `donation-domain-tile-${slug}`,
}));
