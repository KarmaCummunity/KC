// Mapped to spec: FR-POST-001 AC1 / AC6.
// Pure state helpers of the unified create form: direction ↔ post type mapping, remembered
// category + per-category direction, usage counts for picker order (parsed defensively from storage).
import type { PostType } from '@kc/domain';
import {
  CREATE_CATEGORIES,
  DEFAULT_CREATE_CATEGORY,
  isCreateCategoryId,
  isCreateDirection,
  type CreateCategoryConfig,
  type CreateCategoryId,
  type CreateDirection,
} from './createCategories';

export function directionToPostType(direction: CreateDirection): PostType {
  return direction === 'give' ? 'Give' : 'Request';
}

export function postTypeToDirection(type: PostType): CreateDirection {
  return type === 'Give' ? 'give' : 'request';
}

/** Direction each category was last used in; a category never used has no entry. */
export type CategoryDirections = Readonly<Partial<Record<CreateCategoryId, CreateDirection>>>;

/** How often the member picked each category in the create form (device-local). */
export type CategoryUsageCounts = Readonly<Partial<Record<CreateCategoryId, number>>>;

/**
 * What the form remembers between visits (FR-POST-001 AC1 / AC6): the last category, and per
 * category whether the user last gave or asked — items may be given while rides are asked for.
 */
export interface CreatePreferences {
  readonly categoryId: CreateCategoryId;
  readonly directions: CategoryDirections;
  readonly usageCounts: CategoryUsageCounts;
}

export const DEFAULT_CREATE_DIRECTION: CreateDirection = 'give';

export const DEFAULT_CREATE_PREFERENCES: CreatePreferences = {
  categoryId: DEFAULT_CREATE_CATEGORY,
  directions: {},
  usageCounts: {},
};

/** The direction to open `categoryId` in: the one last used there, else the default (offer). */
export function directionFor(prefs: CreatePreferences, categoryId: CreateCategoryId): CreateDirection {
  return prefs.directions[categoryId] ?? DEFAULT_CREATE_DIRECTION;
}

/** `prefs` with `categoryId` switched to and, when given, its direction recorded. */
export function withCategory(
  prefs: CreatePreferences,
  categoryId: CreateCategoryId,
  direction?: CreateDirection,
  bumpUsage = false,
): CreatePreferences {
  const usageCounts: CategoryUsageCounts = bumpUsage
    ? { ...prefs.usageCounts, [categoryId]: (prefs.usageCounts[categoryId] ?? 0) + 1 }
    : prefs.usageCounts;
  return {
    categoryId,
    directions: direction ? { ...prefs.directions, [categoryId]: direction } : prefs.directions,
    usageCounts,
  };
}

/** Picker order: most-used categories first; ties and unused categories keep hub order. */
export function sortCreateCategoriesByUsage(
  categories: readonly CreateCategoryConfig[],
  usageCounts: CategoryUsageCounts,
): readonly CreateCategoryConfig[] {
  const hubIndex = new Map(categories.map((c, i) => [c.id, i]));
  const count = (id: CreateCategoryId) => usageCounts[id] ?? 0;
  return [...categories].sort((a, b) => {
    const byUsage = count(b.id) - count(a.id);
    if (byUsage !== 0) return byUsage;
    return (hubIndex.get(a.id) ?? 0) - (hubIndex.get(b.id) ?? 0);
  });
}

/** Sorted create categories for the current usage snapshot (defaults to hub order). */
export function createCategoriesForPicker(usageCounts: CategoryUsageCounts): readonly CreateCategoryConfig[] {
  return sortCreateCategoriesByUsage(CREATE_CATEGORIES, usageCounts);
}

function parseUsageCounts(value: unknown): CategoryUsageCounts {
  if (typeof value !== 'object' || value === null) return {};
  const out: Partial<Record<CreateCategoryId, number>> = {};
  for (const [category, count] of Object.entries(value)) {
    if (
      isCreateCategoryId(category) &&
      typeof count === 'number' &&
      Number.isFinite(count) &&
      count > 0
    ) {
      out[category] = Math.floor(count);
    }
  }
  return out;
}

/** Keeps only entries that name a known category and a valid direction. */
function parseDirections(value: unknown): CategoryDirections {
  if (typeof value !== 'object' || value === null) return {};
  const out: Partial<Record<CreateCategoryId, CreateDirection>> = {};
  for (const [category, direction] of Object.entries(value)) {
    if (isCreateCategoryId(category) && isCreateDirection(direction)) out[category] = direction;
  }
  return out;
}

/**
 * Parses stored preferences. Corrupt JSON, a removed category or a bad direction is dropped field
 * by field, so an old app version's value can never break the form. The first release stored a
 * single `{ categoryId, direction }`; that direction now belongs to its category.
 */
export function parseCreatePreferences(raw: string | null | undefined): CreatePreferences {
  if (!raw) return DEFAULT_CREATE_PREFERENCES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_CREATE_PREFERENCES;
  }
  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_CREATE_PREFERENCES;
  const { categoryId, directions, direction, usageCounts } = parsed as Record<string, unknown>;
  const category = isCreateCategoryId(categoryId) ? categoryId : DEFAULT_CREATE_PREFERENCES.categoryId;
  const stored = parseDirections(directions);
  const legacy = isCreateDirection(direction) && isCreateCategoryId(categoryId) ? { [categoryId]: direction } : {};
  return {
    categoryId: category,
    directions: { ...legacy, ...stored },
    usageCounts: parseUsageCounts(usageCounts),
  };
}

export function serializeCreatePreferences(prefs: CreatePreferences): string {
  return JSON.stringify({
    categoryId: prefs.categoryId,
    directions: prefs.directions,
    usageCounts: prefs.usageCounts,
  });
}
