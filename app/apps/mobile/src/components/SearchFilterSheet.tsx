// Bottom sheet for advanced search filters (FR-FEED-017+).
// Local state mirrors store so the user can preview before applying.
// Rebuilt on top of the shared filterKit (issue #1457).
import React, { useState } from 'react';
import { View } from 'react-native';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { ALL_CATEGORIES, DONATION_CATEGORY_SLUGS, RADIUS_OPTIONS_KM } from '@kc/domain';
import type { Category, DonationCategorySlug, PostType, SearchSortBy } from '@kc/domain';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useSearchStore } from '../store/searchStore';
import { CityPicker } from './CityPicker';
import { FilterSheetFrame, FilterSection, SortSection } from './filterKit';
import { rtlTextAlignStart } from '../lib/rtlTextAlignStart';

const DEFAULT_RADIUS_KM = 5;

interface Props {
  readonly visible: boolean;
  readonly onClose: () => void;
}

export function SearchFilterSheet({ visible, onClose }: Props) {
  const styles = useStyles();
  const { t } = useTranslation();
  const store = useSearchStore(
    useShallow((s) => ({
      postType: s.postType,
      category: s.category,
      donationCategory: s.donationCategory,
      city: s.city,
      cityName: s.cityName,
      radiusKm: s.radiusKm,
      sortBy: s.sortBy,
      setPostType: s.setPostType,
      setCategory: s.setCategory,
      setDonationCategory: s.setDonationCategory,
      setCity: s.setCity,
      setRadiusKm: s.setRadiusKm,
      setSortBy: s.setSortBy,
      clearFilters: s.clearFilters,
    })),
  );
  const [postType, setPostType] = useState<PostType | null>(store.postType);
  const [category, setCategory] = useState<Category | null>(store.category);
  const [donationCategory, setDonationCategory] = useState<DonationCategorySlug | null>(store.donationCategory);
  const [city, setCity] = useState<{ id: string; name: string } | null>(
    store.city ? { id: store.city, name: store.cityName ?? '' } : null,
  );
  const [radiusKm, setRadiusKm] = useState<number | null>(store.radiusKm);
  const [sortBy, setSortBy] = useState<SearchSortBy>(store.sortBy);

  // Whenever the city changes, gate the radius accordingly: pick a sensible
  // default the first time a city is set; drop the radius when the city is
  // cleared (radius alone is meaningless).
  const handleCityChange = (next: { id: string; name: string } | null) => {
    setCity(next);
    if (!next) {
      setRadiusKm(null);
    } else if (radiusKm == null) {
      setRadiusKm(DEFAULT_RADIUS_KM);
    }
  };

  const handleApply = () => {
    store.setPostType(postType);
    store.setCategory(category);
    store.setDonationCategory(donationCategory);
    store.setCity(city?.id ?? null, city?.name ?? null);
    store.setRadiusKm(city ? radiusKm : null);
    store.setSortBy(sortBy);
    onClose();
  };

  const handleClear = () => {
    setPostType(null);
    setCategory(null);
    setDonationCategory(null);
    setCity(null);
    setRadiusKm(null);
    setSortBy('relevance');
    store.clearFilters();
    onClose();
  };

  const sortOptions = (['relevance', 'newest', 'followers'] as SearchSortBy[]).map((s) => ({
    value: s,
    label: s === 'relevance'
      ? t('search.sortRelevance')
      : s === 'newest'
        ? t('search.sortNewest')
        : t('search.sortFollowers'),
  }));

  const postTypeOptions = [
    { value: 'Give' as const, label: t('search.give') },
    { value: 'Request' as const, label: t('search.request') },
  ];

  const categoryOptions = ALL_CATEGORIES.map((c) => ({
    value: c,
    label: t(`search.categories.${c}`),
  }));

  const donationCategoryOptions = DONATION_CATEGORY_SLUGS.map((slug) => ({
    value: slug,
    label: t(`search.donationCategories.${slug}`),
  }));

  const radiusOptions = RADIUS_OPTIONS_KM.map((km) => ({
    value: km,
    label: t('search.radiusKm').replace('{km}', String(km)),
  }));

  return (
    <FilterSheetFrame
      visible={visible}
      onDismiss={onClose}
      title={t('search.filters')}
      applyLabel={t('search.applyFilters')}
      onApply={handleApply}
      clearLabel={t('search.clearFilters')}
      onClear={handleClear}
    >
      <SortSection<SearchSortBy>
        title={t('search.sortBy')}
        options={sortOptions}
        value={sortBy}
        onChange={setSortBy}
      />

      <FilterSection<PostType>
        title={t('search.filterPostType')}
        allLabel={t('search.all')}
        options={postTypeOptions}
        value={postType}
        onChange={setPostType}
      />

      <FilterSection<Category>
        title={t('search.filterCategory')}
        allLabel={t('search.all')}
        options={categoryOptions}
        value={category}
        onChange={setCategory}
      />

      <FilterSection<DonationCategorySlug>
        title={t('search.filterDonationCategory')}
        allLabel={t('search.all')}
        options={donationCategoryOptions}
        value={donationCategory}
        onChange={setDonationCategory}
      />

      <View style={styles.citySection}>
        <Text style={styles.cityTitle}>{t('search.filterCity')}</Text>
        <CityPicker
          value={city}
          onChange={(sel: { id: string; name: string }) => handleCityChange(sel)}
        />
      </View>

      {/* Radius picker — only visible after a city is selected. Mirrors
          the PostFilterSheet pattern (FR-FEED-006). */}
      {city && (
        <FilterSection<number>
          title={t('search.filterRadius')}
          showAllChip={false}
          options={radiusOptions}
          value={radiusKm}
          onChange={setRadiusKm}
        />
      )}
    </FilterSheetFrame>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  citySection: { gap: spacing.xs, marginBottom: spacing.md },
  cityTitle: { ...typography.label, color: colors.textPrimary, textAlign: rtlTextAlignStart },
}));
