// Mapped to spec: FR-POST-001 AC1 / AC6.
// Pure state helpers of the unified create form: direction ↔ post type mapping and the
// remembered "last used" category + direction (parsed defensively from local storage).
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

/** What the form remembers between visits (FR-POST-001 AC1: toggle; AC6: category). */
export interface CreatePreferences {
  readonly categoryId: CreateCategoryId;
  readonly direction: CreateDirection;
}

export const DEFAULT_CREATE_PREFERENCES: CreatePreferences = {
  categoryId: DEFAULT_CREATE_CATEGORY,
  direction: 'give',
};

/**
 * Parses stored preferences. Corrupt JSON, a removed category or a bad direction falls back
 * field by field to the defaults, so an old app version's value can never break the form.
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
  const { categoryId, direction } = parsed as Record<string, unknown>;
  return {
    categoryId: isCreateCategoryId(categoryId) ? categoryId : DEFAULT_CREATE_PREFERENCES.categoryId,
    direction: isCreateDirection(direction) ? direction : DEFAULT_CREATE_PREFERENCES.direction,
  };
}

export function serializeCreatePreferences(prefs: CreatePreferences): string {
  return JSON.stringify({ categoryId: prefs.categoryId, direction: prefs.direction });
}
