// D100 (docs/spec/04_product_structure.md): the one list of giving worlds. There is no
// separate "domain" layer — a former domain is either a world of its own or a sub-category
// of a world. Order is the order the Donations tab shows them in.
import type { DonationCategorySlug } from '../value-objects';

export const GIVING_WORLD_SLUGS = [
  'items', 'food', 'rides', 'time', 'money', 'housing', 'knowledge',
  'medical', 'animals', 'democracy', 'employment', 'challenges',
] as const;
export type GivingWorldSlug = (typeof GIVING_WORLD_SLUGS)[number];

/**
 * Worlds that publish into the marketplace (a feed of offers and requests and an in-app create
 * form). Every other world is a portal: links and knowledge only, until its flow ships.
 */
export const FEED_WORLD_SLUGS = ['items', 'food', 'rides', 'time', 'housing', 'animals', 'knowledge'] as const;
export type FeedWorldSlug = (typeof FEED_WORLD_SLUGS)[number];

export function isGivingWorldSlug(value: string): value is GivingWorldSlug {
  return (GIVING_WORLD_SLUGS as readonly string[]).includes(value);
}

export function isFeedWorldSlug(value: string): value is FeedWorldSlug {
  return (FEED_WORLD_SLUGS as readonly string[]).includes(value);
}

/**
 * The community-links category (`donation_categories.slug`) that belongs to a world; null when
 * the world has none (items). The rides world keeps its legacy `transport` links slug.
 */
export function linkCategoryForWorld(world: string): DonationCategorySlug | null {
  if (world === 'rides') return 'transport';
  if (world === 'items' || !isGivingWorldSlug(world)) return null;
  // Every remaining world shares its slug with its links category.
  return world as Exclude<GivingWorldSlug, 'items' | 'rides'>;
}
