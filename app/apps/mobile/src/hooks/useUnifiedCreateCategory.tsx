// Mapped to spec: FR-POST-001 AC1 / AC6.
// Unified create: the active category + direction, the header that edits them, and their
// persistence. A `?category=` deep link wins over the remembered choice, and its optional
// `&direction=` presets request / offer (a world screen's buttons, FR-FEED-020 AC2);
// otherwise the form reopens on the category and direction the user last used.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import type { PostType } from '@kc/domain';
import { UnifiedCreateHeader } from '../components/CreatePostForm/UnifiedCreateHeader';
import {
  CREATE_CATEGORIES,
  findCreateCategory,
  isCreateCategoryId,
  isCreateDirection,
  type CreateCategoryId,
  type CreateDirection,
} from '../lib/unifiedCreate/createCategories';
import {
  DEFAULT_CREATE_PREFERENCES,
  directionToPostType,
  postTypeToDirection,
} from '../lib/unifiedCreate/unifiedCreateState';
import {
  loadCreatePreferences,
  saveCreatePreferences,
} from '../lib/unifiedCreate/createPreferencesStorage';

/** Expo Router may hand a repeated query key over as an array; keep the first value. */
function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function useUnifiedCreateCategory(
  userId: string | null | undefined,
  type: PostType,
  setType: (t: PostType) => void,
) {
  const params = useLocalSearchParams<{ category?: string | string[]; direction?: string | string[] }>();
  const deepLink = firstParam(params.category);
  // Honoured only together with a known category, like createRouteFor builds it.
  const deepLinkDirection = isCreateCategoryId(deepLink) ? firstParam(params.direction) : undefined;
  const [categoryId, setCategoryId] = useState<CreateCategoryId>(
    isCreateCategoryId(deepLink) ? deepLink : DEFAULT_CREATE_PREFERENCES.categoryId,
  );
  // False until the remembered choice is read, so the form never flashes the default first.
  const [ready, setReady] = useState(isCreateCategoryId(deepLink));
  // Latest setType without making the load effect depend on its identity.
  const setTypeRef = useRef(setType);
  setTypeRef.current = setType;

  // Restore the last used category + direction once per user (skipped for a deep link).
  useEffect(() => {
    if (isCreateCategoryId(deepLink)) return;
    let active = true;
    void loadCreatePreferences(userId).then((prefs) => {
      if (!active) return;
      setCategoryId(prefs.categoryId);
      setTypeRef.current(directionToPostType(prefs.direction));
      setReady(true);
    });
    return () => {
      active = false;
    };
    // Deep-link changes are handled by the effect below; re-reading storage there would
    // overwrite the deep-linked category.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // A deep link (on mount, or while the tab is already mounted) switches the category and,
  // when it names one, the direction.
  useEffect(() => {
    if (!isCreateCategoryId(deepLink)) return;
    setCategoryId(deepLink);
    if (isCreateDirection(deepLinkDirection)) setTypeRef.current(directionToPostType(deepLinkDirection));
    setReady(true);
  }, [deepLink, deepLinkDirection]);

  const direction = postTypeToDirection(type);

  const changeCategory = useCallback(
    (next: CreateCategoryId) => {
      setCategoryId(next);
      void saveCreatePreferences(userId, { categoryId: next, direction });
    },
    [userId, direction],
  );

  const changeDirection = useCallback(
    (next: CreateDirection) => {
      setType(directionToPostType(next));
      void saveCreatePreferences(userId, { categoryId, direction: next });
    },
    [userId, categoryId, setType],
  );

  const activeCategory = findCreateCategory(categoryId);
  const header = (
    <UnifiedCreateHeader
      categories={CREATE_CATEGORIES}
      categoryId={activeCategory.id}
      onCategoryChange={changeCategory}
      direction={direction}
      onDirectionChange={changeDirection}
    />
  );
  return { activeCategory, direction, header, ready, selectCategory: changeCategory };
}
