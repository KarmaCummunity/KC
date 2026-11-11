// Mapped to spec: FR-FEED-020 AC1 (every create category in the main feed) · docs/spec/07 §7.4
// (the card shows its world chip and icon).
// Chooses the chip label and placeholder icon of a feed card. A feed mirror of a rides,
// food, housing or time listing (D-206) shows its giving world; its legacy post category is
// only "Other". Ordinary posts and items mirrors keep their item subcategory (Books, Toys…).
import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';
import { isFeedWorldSlug, type Post } from '@kc/domain';
import { CREATE_CATEGORIES } from './unifiedCreate/createCategories';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export interface FeedCardCategory {
  /** i18n key of the chip label. */
  readonly chipKey: string;
  /** Placeholder icon shown when the card has no photo. */
  readonly icon: IoniconName;
}

/** Placeholder icon per legacy item subcategory; others fall back to the direction icon. */
const ITEM_CATEGORY_ICON: Readonly<Record<string, IoniconName>> = {
  Furniture: 'bed-outline',
  Clothing: 'shirt-outline',
  Books: 'book-outline',
  Toys: 'game-controller-outline',
  BabyGear: 'happy-outline',
  Kitchen: 'restaurant-outline',
  Sports: 'football-outline',
  Electronics: 'phone-portrait-outline',
  Tools: 'construct-outline',
};

type FeedCardPost = Pick<Post, 'category' | 'type' | 'listingWorldSlug'>;

/** Chip label key and placeholder icon for a feed card of `post`. */
export function feedCardCategory(post: FeedCardPost): FeedCardCategory {
  const world = worldCategory(post.listingWorldSlug);
  if (world) {
    return { chipKey: world.labelKey, icon: world.icon };
  }
  const directionIcon: IoniconName = post.type === 'Give' ? 'gift-outline' : 'hand-left-outline';
  return {
    chipKey: `post.category.${post.category}`,
    icon: ITEM_CATEGORY_ICON[post.category] ?? directionIcon,
  };
}

/**
 * Chip label key of a giving world on a card. A world with a feed (items, rides, food, housing,
 * time) reads as the feed's chip does; any other world keeps its marketplace name.
 */
export function worldChipKey(worldSlug: string): string {
  const category = isFeedWorldSlug(worldSlug) ? CREATE_CATEGORIES.find((c) => c.id === worldSlug) : undefined;
  return category?.labelKey ?? `marketplace.world.${worldSlug}`;
}

/**
 * The create category of a mirror's world, when the card should show it: every create
 * category except items, whose mirrors carry the more specific item subcategory.
 */
function worldCategory(worldSlug: string | null) {
  if (!worldSlug || worldSlug === 'items') return null;
  // Challenges publish a post with no listing; the card still names the world.
  if (!isFeedWorldSlug(worldSlug) && worldSlug !== 'challenges') return null;
  return CREATE_CATEGORIES.find((c) => c.id === worldSlug) ?? null;
}
