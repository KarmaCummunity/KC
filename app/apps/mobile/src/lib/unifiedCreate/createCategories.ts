// Mapped to spec: FR-POST-001 (one create form; category first, then request/offer, then
// category-specific fields).
// Category config for the unified create form: which categories the picker offers, in which
// order, and which write path each one uses on submit (legacy post vs marketplace listing).
import type { Href } from 'expo-router';

export type CreateEngine = 'post' | 'listing';
export type CreateDirection = 'give' | 'request';

/** Ionicons glyphs used by the category picker (kept as a closed union for type safety). */
export type CreateCategoryIcon =
  | 'cube-outline'
  | 'car-outline'
  | 'restaurant-outline'
  | 'home-outline'
  | 'time-outline';

export interface CreateCategoryConfig {
  /** Stable id; equals the giving-world slug (also used by the `?category=` deep link). */
  readonly id: CreateCategoryId;
  readonly engine: CreateEngine;
  /** i18n key for the picker label. */
  readonly labelKey: string;
  readonly icon: CreateCategoryIcon;
  /**
   * Marketplace world the listing is written to; null for the post engine. Items posts reach
   * the items world through the posts → listings sync (migration 0243), so they need none.
   */
  readonly worldSlug: string | null;
}

/** Categories with a create form, in picker order (FR-POST-001 AC6). */
export const CREATE_CATEGORY_IDS = ['items', 'rides', 'food', 'housing', 'time'] as const;
export type CreateCategoryId = (typeof CREATE_CATEGORY_IDS)[number];

/** Category the form opens on when there is no deep link and no remembered choice. */
export const DEFAULT_CREATE_CATEGORY: CreateCategoryId = 'items';

/** Worlds whose giver picks a world subcategory in the listing form (food → bakery…), KC#1296. */
export const WORLDS_WITH_SUBCATEGORY_PICKER: readonly string[] = ['items', 'food'];

const ICON_BY_ID: Readonly<Record<CreateCategoryId, CreateCategoryIcon>> = {
  items: 'cube-outline',
  rides: 'car-outline',
  food: 'restaurant-outline',
  housing: 'home-outline',
  time: 'time-outline',
};

function toConfig(id: CreateCategoryId): CreateCategoryConfig {
  // Items keep the mature post form (drafts, address display level, visibility, karma value).
  const isPost = id === 'items';
  return {
    id,
    engine: isPost ? 'post' : 'listing',
    labelKey: `post.unifiedCreate.categories.${id}`,
    icon: ICON_BY_ID[id],
    worldSlug: isPost ? null : id,
  };
}

export const CREATE_CATEGORIES: readonly CreateCategoryConfig[] = CREATE_CATEGORY_IDS.map(toConfig);

/** Type guard: is `id` a category the create form offers? */
export function isCreateCategoryId(id: unknown): id is CreateCategoryId {
  return typeof id === 'string' && (CREATE_CATEGORY_IDS as readonly string[]).includes(id);
}

/** Config for `id`; unknown or missing ids fall back to the default category. */
export function findCreateCategory(id: string | null | undefined): CreateCategoryConfig {
  const resolved = isCreateCategoryId(id) ? id : DEFAULT_CREATE_CATEGORY;
  // Non-null: every id in CREATE_CATEGORY_IDS has a config built from it above.
  return CREATE_CATEGORIES.find((c) => c.id === resolved)!;
}

/** Type guard: is `value` one of the two create directions? */
export function isCreateDirection(value: unknown): value is CreateDirection {
  return value === 'give' || value === 'request';
}

/**
 * Single entry route for every create button; preselects a category when one is given and,
 * with it, a direction (a world screen's "request" / "offer" buttons, FR-FEED-020 AC2). A
 * direction without a known category is dropped: the form would not know where it applies.
 */
export function createRouteFor(categoryId?: string | null, direction?: CreateDirection | null): Href {
  if (!isCreateCategoryId(categoryId)) return '/(tabs)/create';
  const category = encodeURIComponent(categoryId);
  return isCreateDirection(direction)
    ? `/(tabs)/create?category=${category}&direction=${direction}`
    : `/(tabs)/create?category=${category}`;
}
