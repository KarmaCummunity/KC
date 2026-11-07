// Mapped to spec: FR-FEED-004 (filter sheet sections: worlds, subcategories, type, condition, status, source)
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  Category,
  FeedStatusFilter,
  ItemCondition,
  PostType,
  WorldSubcategory,
} from '@kc/domain';
import { FEED_WORLD_SLUGS } from '@kc/domain';
import { marketplaceRepository } from '../../services/marketplaceComposition';
import { worldChipKey } from '../../lib/feedCardCategory';
import { FilterSection } from '../filterKit/FilterSection';

export interface FiltersSectionProps {
  readonly type: PostType | null;
  readonly worlds?: readonly string[];
  readonly world?: string | null;
  readonly subcategories?: readonly string[];
  readonly categories?: readonly Category[];
  readonly itemConditions: readonly ItemCondition[];
  readonly statusFilter: FeedStatusFilter;
  readonly followersOnly: boolean;
  readonly onTypeChange: (t: PostType | null) => void;
  readonly onWorldsChange?: (w: string[]) => void;
  readonly onWorldChange?: (w: string | null) => void;
  readonly onSubcategoriesChange?: (s: string[]) => void;
  readonly onCategoriesChange?: (c: Category[]) => void;
  readonly onItemConditionsChange: (i: ItemCondition[]) => void;
  readonly onStatusFilterChange: (s: FeedStatusFilter) => void;
  readonly onFollowersOnlyChange: (v: boolean) => void;
  /** A world screen's sheet: the world is fixed, so its picker is hidden (subcategories stay). */
  readonly hideWorldPicker?: boolean;
}

/** The worlds that have a feed (D100); portal worlds publish no posts, so they are not filters. */
export const FEED_FILTER_WORLD_SLUGS = FEED_WORLD_SLUGS;

const ITEM_CONDITION_KEYS: Record<ItemCondition, string> = {
  New: 'filters.conditionNew',
  LikeNew: 'filters.conditionLikeNew',
  Good: 'filters.conditionGood',
  Fair: 'filters.conditionFair',
  Damaged: 'filters.conditionDamaged',
};

const STATUS_KEYS: Record<FeedStatusFilter, string> = {
  all: 'filters.all',
  open: 'filters.statusOpenOnly',
  closed: 'filters.statusClosedOnly',
};

const ITEM_CONDITIONS: readonly ItemCondition[] = ['New', 'LikeNew', 'Good', 'Fair', 'Damaged'];

export function FiltersSection(props: FiltersSectionProps) {
  const { t, i18n } = useTranslation();
  const hebrew = i18n?.language?.startsWith('he') ?? false;

  const selectedWorld = props.world !== undefined ? props.world : (props.worlds?.[0] ?? null);
  const selectedSubcategories = props.subcategories ?? [];

  const [subcategoriesList, setSubcategoriesList] = useState<WorldSubcategory[]>([]);

  useEffect(() => {
    if (!selectedWorld) {
      setSubcategoriesList([]);
      return;
    }
    let active = true;
    void marketplaceRepository()
      .listWorldSubcategories(selectedWorld)
      .then((rows) => {
        if (active) setSubcategoriesList(rows ?? []);
      })
      .catch(() => {
        if (active) setSubcategoriesList([]);
      });
    return () => {
      active = false;
    };
  }, [selectedWorld]);

  const handleWorldChange = (nextWorld: string | null) => {
    if (nextWorld !== selectedWorld) {
      props.onWorldChange?.(nextWorld);
      props.onWorldsChange?.(nextWorld ? [nextWorld] : []);
      props.onSubcategoriesChange?.([]);
    }
  };

  const showCondition =
    props.type === 'Give' && (selectedWorld === null || selectedWorld === 'items');

  const worldOptions = FEED_FILTER_WORLD_SLUGS.map((slug) => ({
    value: slug,
    label: t(worldChipKey(slug), { defaultValue: slug }),
    testID: `world-chip-${slug}`,
  }));

  const subcategoryOptions = subcategoriesList.map((s) => ({
    value: s.slug,
    label: hebrew ? s.labelHe : (s.labelEn ?? s.labelHe),
    testID: `subcategory-chip-${s.slug}`,
  }));

  const typeOptions = [
    { value: 'Give' as const, label: t('filters.typeGive') },
    { value: 'Request' as const, label: t('filters.typeRequest') },
  ];

  const conditionOptions = ITEM_CONDITIONS.map((cond) => ({
    value: cond,
    label: t(ITEM_CONDITION_KEYS[cond]),
    testID: `condition-chip-${cond}`,
  }));

  const statusOptions = (['all', 'open', 'closed'] as const).map((s) => ({
    value: s,
    label: t(STATUS_KEYS[s]),
    testID: `status-chip-${s}`,
  }));

  const sourceOptions = [
    { value: 'all' as const, label: t('filters.all'), testID: 'source-chip-all' },
    {
      value: 'followers' as const,
      label: t('filters.followersOnly'),
      testID: 'source-chip-followers',
    },
  ];

  return (
    <>
      <FilterSection
        title={t('filters.sectionType')}
        options={typeOptions}
        value={props.type}
        onChange={props.onTypeChange}
        testID="filters-type"
      />

      {props.hideWorldPicker ? null : (
        <FilterSection
          title={t('filters.sectionWorld', { defaultValue: t('filters.sectionCategory') })}
          options={worldOptions}
          value={selectedWorld}
          onChange={handleWorldChange}
          testID="filters-worlds"
        />
      )}

      {selectedWorld && subcategoriesList.length > 0 ? (
        <FilterSection<string>
          title={t('filters.sectionSubcategory')}
          multiSelect
          options={subcategoryOptions}
          value={selectedSubcategories}
          onChange={(subs) => props.onSubcategoriesChange?.(subs)}
          testID="filters-subcategories"
        />
      ) : null}

      {showCondition ? (
        <FilterSection
          title={t('filters.sectionCondition')}
          multiSelect
          options={conditionOptions}
          value={props.itemConditions}
          onChange={(conds) => props.onItemConditionsChange(conds as ItemCondition[])}
          testID="filters-condition"
        />
      ) : null}

      <FilterSection
        title={t('filters.sectionStatus')}
        showAllChip={false}
        options={statusOptions}
        value={props.statusFilter}
        onChange={(s) => props.onStatusFilterChange(s as FeedStatusFilter)}
        testID="filters-status"
      />

      <FilterSection
        title={t('filters.sectionSource')}
        showAllChip={false}
        options={sourceOptions}
        value={props.followersOnly ? 'followers' : 'all'}
        onChange={(v) => props.onFollowersOnlyChange(v === 'followers')}
        testID="filters-source"
      />
    </>
  );
}
