// Mapped to spec: FR-POST-001 AC1 / AC6.
// Unified create: the active category + direction, the header that edits them, and their
// persistence. A `?category=` deep link wins over the remembered choice, and its optional
// `&direction=` presets request / offer (a world screen's buttons, FR-FEED-020 AC2);
// otherwise the form reopens on the category the user last used. The direction (offer / request)
// is remembered per category: every category reopens in the way it was last used.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import type { PostType } from '@kc/domain';
import { useRemoteAppFlags } from './useLaunchWorldFlags';
import { UnifiedCreateHeader } from '../components/CreatePostForm/UnifiedCreateHeader';
import {
  CREATE_CATEGORIES,
  findCreateCategory,
  isCreateCategoryId,
  isCreateDirection,
  resolveCreateCategory,
  type CreateCategoryId,
  type CreateDirection,
} from '../lib/unifiedCreate/createCategories';
import {
  DEFAULT_CREATE_PREFERENCES,
  directionFor,
  directionToPostType,
  postTypeToDirection,
  withCategory,
  type CreatePreferences,
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
  const [ready, setReady] = useState(false);
  // What was last remembered; mutated in place so every handler sees the latest choice.
  const prefsRef = useRef<CreatePreferences>(DEFAULT_CREATE_PREFERENCES);
  // Latest setType without making the effects depend on its identity.
  const setTypeRef = useRef(setType);
  setTypeRef.current = setType;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  /** Opens `id` in `direction`, or in the direction last used there, and remembers it. */
  const open = useCallback((id: CreateCategoryId, direction?: CreateDirection) => {
    const prefs = withCategory(prefsRef.current, id, direction);
    prefsRef.current = prefs;
    setCategoryId(id);
    setTypeRef.current(directionToPostType(directionFor(prefs, id)));
    void saveCreatePreferences(userIdRef.current, prefs);
  }, []);

  // Restore the remembered choice once per user. A `?category=` deep link wins over the remembered
  // category but still opens in that category's remembered direction.
  useEffect(() => {
    let active = true;
    void loadCreatePreferences(userId).then((prefs) => {
      if (!active) return;
      prefsRef.current = prefs;
      const id = isCreateCategoryId(deepLink) ? deepLink : prefs.categoryId;
      setCategoryId(id);
      const direction = isCreateDirection(deepLinkDirection) ? deepLinkDirection : directionFor(prefs, id);
      setTypeRef.current(directionToPostType(direction));
      setReady(true);
    });
    return () => {
      active = false;
    };
    // Deep-link changes are handled by the effect below; re-reading storage there would
    // overwrite the deep-linked category.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // A deep link while the tab is already mounted (the "+" button from another world) switches
  // the category and, when it names one, the direction.
  useEffect(() => {
    if (!ready || !isCreateCategoryId(deepLink)) return;
    open(deepLink, isCreateDirection(deepLinkDirection) ? deepLinkDirection : undefined);
    // `ready` only gates the first load; later changes of it must not re-open the category.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLink, deepLinkDirection]);

  const direction = postTypeToDirection(type);

  const changeDirection = useCallback(
    (next: CreateDirection) => open(categoryId, next),
    [open, categoryId],
  );

  const remoteFlags = useRemoteAppFlags();
  const activeCategory = resolveCreateCategory(findCreateCategory(categoryId), remoteFlags);
  const header = (
    <UnifiedCreateHeader
      categories={CREATE_CATEGORIES}
      categoryId={activeCategory.id}
      onCategoryChange={open}
      showDirection={activeCategory.engine !== 'link'}
      direction={direction}
      onDirectionChange={changeDirection}
    />
  );
  return { activeCategory, direction, header, ready, selectCategory: open };
}
