// Mapped to spec: FR-FEED-004 / FR-FEED-006 (sort options inside PostFilterSheet)
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { FeedSortOrder } from '@kc/domain';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { CityPicker } from '../CityPicker';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { SortSection as KitSortSection } from '../filterKit/SortSection';

interface SortSectionProps {
  sortOrder: FeedSortOrder;
  proximitySortCity: { id: string; name: string } | null;
  onSortOrderChange: (s: FeedSortOrder) => void;
  onProximitySortCityChange: (c: { id: string; name: string } | null) => void;
}

const SORT_KEYS: Record<FeedSortOrder, string> = {
  newest: 'filters.sortNewest',
  oldest: 'filters.sortOldest',
  distance: 'filters.sortDistance',
  personalized: 'filters.sortPersonalized',
};

const SORT_ORDER_ENTRIES: FeedSortOrder[] = ['newest', 'personalized', 'oldest', 'distance'];

export function SortSection({
  sortOrder,
  proximitySortCity,
  onSortOrderChange,
  onProximitySortCityChange,
}: SortSectionProps) {
  const { t } = useTranslation();
  const styles = useSortSectionStyles();

  const options = SORT_ORDER_ENTRIES.map((s) => ({
    value: s,
    label: t(SORT_KEYS[s]),
  }));

  return (
    <KitSortSection
      title={t('filters.sectionSort')}
      options={options}
      value={sortOrder}
      onChange={onSortOrderChange}
    >
      {sortOrder === 'distance' && (
        <View style={styles.cityWrap}>
          <Text style={styles.subLabel}>{t('filters.sortDistanceCenterHint')}</Text>
          <CityPicker value={proximitySortCity} onChange={onProximitySortCityChange} />
        </View>
      )}
    </KitSortSection>
  );
}

const useSortSectionStyles = makeUseStyles(({ colors }) => ({
  subLabel: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  cityWrap: { gap: spacing.xs, marginTop: spacing.sm },
}));
