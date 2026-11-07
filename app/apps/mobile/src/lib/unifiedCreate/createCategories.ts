// Mapped to spec: FR-POST-001 (one create form; category first, then request/offer, then
// category-specific fields), D100 (one list of giving worlds).
// Category config for the unified create form: which categories the picker offers, in which
// order, and which write path each one uses on submit — the legacy post (items), a marketplace
// listing (worlds with a feed), or a community link (portal worlds, which have no feed yet).
import type { Href } from 'expo-router';
import {
  GIVING_WORLD_SLUGS,
  isFeedWorldSlug,
  isMarketplaceWorldLaunchEnabled,
  linkCategoryForWorld,
  type DonationCategorySlug,
  type GivingWorldSlug,
  type RemoteAppFlags,
} from '@kc/domain';

export type CreateEngine = 'post' | 'listing' | 'link';
export type CreateDirection = 'give' | 'request';

/** Ionicons glyphs used by the category picker (kept as a closed union for type safety). */
export type CreateCategoryIcon =
  | 'cube-outline'
  | 'car-outline'
  | 'restaurant-outline'
  | 'home-outline'
  | 'time-outline'
  | 'cash-outline'
  | 'school-outline'
  | 'medical-outline'
  | 'paw-outline'
  | 'megaphone-outline'
  | 'briefcase-outline'
  | 'trophy-outline';

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
  /** Community-links category the `link` engine writes to; null for the other engines. */
  readonly linkCategory: DonationCategorySlug | null;
}

/** Categories with a create form, in picker order (FR-POST-001 AC6). */
export const CREATE_CATEGORY_IDS = GIVING_WORLD_SLUGS;
export type CreateCategoryId = GivingWorldSlug;

/** Category the form opens on when there is no deep link and no remembered choice. */
export const DEFAULT_CREATE_CATEGORY: CreateCategoryId = 'items';

/** Worlds whose giver picks a world subcategory in the listing form (food → bakery…), KC#1296. */
export const WORLDS_WITH_SUBCATEGORY_PICKER: readonly string[] = ['items', 'food', 'knowledge'];

const ICON_BY_ID: Readonly<Record<CreateCategoryId, CreateCategoryIcon>> = {
  items: 'cube-outline',
  rides: 'car-outline',
  food: 'restaurant-outline',
  housing: 'home-outline',
  time: 'time-outline',
  money: 'cash-outline',
  knowledge: 'school-outline',
  medical: 'medical-outline',
  animals: 'paw-outline',
  democracy: 'megaphone-outline',
  employment: 'briefcase-outline',
  challenges: 'trophy-outline',
};

/**
 * Worlds whose listing form opens only once the world is launched (D60). Until then they are
 * portals and take community links, like the challenges world; production keeps that while the
 * remote flag is off, tester builds launch them (#1630, #1625).
 */
const LAUNCH_GATED_LISTING_WORLDS: readonly string[] = ['knowledge', 'animals'];

/** Items keep the mature post form (drafts, address display level, visibility, karma value). */
function engineFor(id: CreateCategoryId): CreateEngine {
  if (id === 'items') return 'post';
  if (LAUNCH_GATED_LISTING_WORLDS.includes(id)) return 'link';
  return isFeedWorldSlug(id) ? 'listing' : 'link';
}

function toConfig(id: CreateCategoryId): CreateCategoryConfig {
  const engine = engineFor(id);
  return {
    id,
    engine,
    labelKey: `post.unifiedCreate.categories.${id}`,
    icon: ICON_BY_ID[id],
    worldSlug: engine === 'listing' ? id : null,
    linkCategory: engine === 'link' ? linkCategoryForWorld(id) : null,
  };
}

export const CREATE_CATEGORIES: readonly CreateCategoryConfig[] = CREATE_CATEGORY_IDS.map(toConfig);

/**
 * The category as the form should use it right now. A launch-gated world (knowledge, animals)
 * keeps its community-link form (a portal) until it is launched; once it is, members publish
 * marketplace listings (#1630, #1625), like the challenges world (D60).
 */
export function resolveCreateCategory(
  category: CreateCategoryConfig,
  remote: RemoteAppFlags | undefined,
): CreateCategoryConfig {
  if (!LAUNCH_GATED_LISTING_WORLDS.includes(category.id) || !isMarketplaceWorldLaunchEnabled(category.id, remote)) {
    return category;
  }
  return { ...category, engine: 'listing', worldSlug: category.id, linkCategory: null };
}

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
  if (!isCreateCategoryId(categoryId)) return '/create';
  const category = encodeURIComponent(categoryId);
  return isCreateDirection(direction)
    ? `/create?category=${category}&direction=${direction}`
    : `/create?category=${category}`;
}

/**
 * The create category a screen path belongs to, so the "+" button opens the form on the world
 * the user is looking at: `/donations/food` → food, `/donations/category/medical` → medical.
 * Null when the path is not inside a giving world (home feed, a single listing, profile…).
 */
export function createCategoryForPath(pathname: string | null | undefined): CreateCategoryId | null {
  const match = /^\/donations\/(?:category\/)?([a-z]+)/.exec(pathname ?? '');
  return match && isCreateCategoryId(match[1]) ? match[1] : null;
}
