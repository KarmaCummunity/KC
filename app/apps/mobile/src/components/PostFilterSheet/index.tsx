// PostFilterSheet — bottom-sheet for the Home Feed's sort + filter affordances.
// Mapped to SRS: FR-FEED-003 (text search), FR-FEED-004 (filter modal),
// FR-FEED-005 (persisted state), FR-FEED-006 (distance sort), FR-FEED-018,
// FR-FEED-020 (followers-only scope).
// Rebuilt on top of the shared filterKit (issue #1457).

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  Category,
  FeedSortOrder,
  FeedStatusFilter,
  ItemCondition,
  LocationFilter,
  PostType,
} from '@kc/domain';
import { FilterSheetFrame } from '../filterKit/FilterSheetFrame';
import { SortSection } from './SortSection';
import { FiltersSection } from './FiltersSection';
import { LocationFilterSection } from './LocationFilterSection';
import { SearchSection } from './SearchSection';
import { FeedSettingsLinkSection } from './FeedSettingsLinkSection';

/**
 * Compact cap so the feed stays visible behind the sheet (FR-FEED-004 AC3:
 * "maxHeight ~55–60%").
 */
const FILTER_SHEET_MAX_HEIGHT = '58%';

export interface PostFilterValue {
  type: PostType | null;
  worlds?: string[];
  subcategories?: string[];
  categories?: Category[];
  itemConditions: ItemCondition[];
  locationFilter: LocationFilter | null;
  statusFilter: FeedStatusFilter;
  sortOrder: FeedSortOrder;
  proximitySortCity: string | null;
  proximitySortCityName: string | null;
  followersOnly: boolean;
  searchQuery: string;
}

interface PostFilterSheetProps {
  readonly visible: boolean;
  readonly value: PostFilterValue;
  readonly onPatch: (patch: Partial<PostFilterValue>) => void;
  readonly onClear: () => void;
  readonly onClose: () => void;
  /** A giving world's screen: the world is locked and its picker hidden (FR-FEED-020 AC2). */
  readonly lockedWorld?: boolean;
  /** Home feed only — opens feed mute / hide settings (keywords, categories, people). */
  readonly onOpenFeedSettings?: () => void;
}

export function PostFilterSheet({
  visible,
  value,
  onPatch,
  onClear,
  onClose,
  lockedWorld = false,
  onOpenFeedSettings,
}: PostFilterSheetProps) {
  const { t } = useTranslation();

  const handleSearchQueryChange = useCallback(
    (q: string) => onPatch({ searchQuery: q }),
    [onPatch],
  );

  const handleClear = () => {
    onClear();
    onClose();
  };

  return (
    <FilterSheetFrame
      visible={visible}
      onDismiss={onClose}
      title={t('filters.header')}
      maxHeight={FILTER_SHEET_MAX_HEIGHT}
      clearLabel={t('filters.clearAll')}
      onClear={handleClear}
    >
      {visible ? (
        <SearchSection
          searchQuery={value.searchQuery}
          sheetVisible={visible}
          onSearchQueryChange={handleSearchQueryChange}
        />
      ) : null}
      <SortSection
        sortOrder={value.sortOrder}
        proximitySortCity={
          value.proximitySortCity && value.proximitySortCityName
            ? { id: value.proximitySortCity, name: value.proximitySortCityName }
            : null
        }
        onSortOrderChange={(s) => onPatch({ sortOrder: s })}
        onProximitySortCityChange={(c) =>
          onPatch({
            proximitySortCity: c?.id ?? null,
            proximitySortCityName: c?.name ?? null,
          })
        }
      />
      <FiltersSection
        type={value.type}
        worlds={value.worlds ?? []}
        subcategories={value.subcategories ?? []}
        categories={value.categories}
        itemConditions={value.itemConditions}
        statusFilter={value.statusFilter}
        followersOnly={value.followersOnly}
        onTypeChange={(type) => onPatch({ type })}
        onWorldsChange={(worlds) => onPatch({ worlds })}
        onSubcategoriesChange={(subcategories) => onPatch({ subcategories })}
        onCategoriesChange={(categories) => onPatch({ categories })}
        onItemConditionsChange={(itemConditions) => onPatch({ itemConditions })}
        onStatusFilterChange={(statusFilter) => onPatch({ statusFilter })}
        onFollowersOnlyChange={(followersOnly) => onPatch({ followersOnly })}
        hideWorldPicker={lockedWorld}
      />
      <LocationFilterSection
        value={value.locationFilter}
        onChange={(locationFilter) => onPatch({ locationFilter })}
      />
      {!lockedWorld && onOpenFeedSettings ? (
        <FeedSettingsLinkSection onPress={onOpenFeedSettings} />
      ) : null}
    </FilterSheetFrame>
  );
}
