// Mapped to spec: FR-POST-001 AC1 / AC6.
// Pure state helpers of the unified create form: direction ↔ post type mapping and the
// remembered "last used" category and per-category direction (parsed defensively from local storage).
import type { PostType } from '@kc/domain';
import {
  DEFAULT_CREATE_CATEGORY,
  isCreateCategoryId,
  isCreateDirection,
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

/**
 * What the form remembers between visits (FR-POST-001 AC1 / AC6): the last category, and per
 * category whether the user last gave or asked — items may be given while rides are asked for.
 */
export interface CreatePreferences {
  readonly categoryId: CreateCategoryId;
  readonly directions: CategoryDirections;
}

export const DEFAULT_CREATE_DIRECTION: CreateDirection = 'give';

export const DEFAULT_CREATE_PREFERENCES: CreatePreferences = {
  categoryId: DEFAULT_CREATE_CATEGORY,
  directions: {},
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
): CreatePreferences {
  return {
    categoryId,
    directions: direction ? { ...prefs.directions, [categoryId]: direction } : prefs.directions,
  };
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
  const { categoryId, directions, direction } = parsed as Record<string, unknown>;
  const category = isCreateCategoryId(categoryId) ? categoryId : DEFAULT_CREATE_PREFERENCES.categoryId;
  const stored = parseDirections(directions);
  const legacy = isCreateDirection(direction) && isCreateCategoryId(categoryId) ? { [categoryId]: direction } : {};
  return { categoryId: category, directions: { ...legacy, ...stored } };
}

export function serializeCreatePreferences(prefs: CreatePreferences): string {
  return JSON.stringify({ categoryId: prefs.categoryId, directions: prefs.directions });
}
