// Mapped to spec: FR-DONATE-007 / FR-KNOW-* — search box, item-type filter and sort of a giving
// world's community-links screen. Controlled: the screen owns the state so the list and the
// info-posts section react to the same values.
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing } from '@kc/ui';
import { FilterSearchBar } from '../filterKit/FilterSearchBar';
import { SortSection } from '../filterKit/SortSection';
import type { WorldLinksKind, WorldLinksSort } from '../../lib/worldLinksCatalog';

const useStyles = makeUseStyles(() => ({
  wrap: { gap: spacing.sm, marginBottom: spacing.md },
}));

export interface WorldLinksToolbarProps {
  readonly query: string;
  readonly onQueryChange: (text: string) => void;
  readonly kind: WorldLinksKind;
  readonly onKindChange: (kind: WorldLinksKind) => void;
  readonly sort: WorldLinksSort;
  readonly onSortChange: (sort: WorldLinksSort) => void;
}

export function WorldLinksToolbar({
  query,
  onQueryChange,
  kind,
  onKindChange,
  sort,
  onSortChange,
}: Readonly<WorldLinksToolbarProps>) {
  const { t } = useTranslation();
  const styles = useStyles();

  // testIDs are literals so the Maestro contract check can find them.
  const kindOptions = [
    { value: 'all' as const, label: t('donations.worldLinks.kindAll'), testID: 'world-links-kind-all' },
    { value: 'links' as const, label: t('donations.worldLinks.kindLinks'), testID: 'world-links-kind-links' },
    { value: 'posts' as const, label: t('donations.worldLinks.kindPosts'), testID: 'world-links-kind-posts' },
  ];
  const sortOptions = [
    { value: 'newest' as const, label: t('donations.worldLinks.sortNewest'), testID: 'world-links-sort-newest' },
    { value: 'oldest' as const, label: t('donations.worldLinks.sortOldest'), testID: 'world-links-sort-oldest' },
    { value: 'alpha' as const, label: t('donations.worldLinks.sortAlpha'), testID: 'world-links-sort-alpha' },
  ];

  return (
    <View style={styles.wrap} testID="world-links-toolbar">
      <FilterSearchBar
        testID="world-links-search"
        value={query}
        onChangeText={onQueryChange}
        placeholder={t('donations.worldLinks.searchPlaceholder')}
        accessibilityLabel={t('donations.worldLinks.searchA11y')}
      />
      <SortSection<WorldLinksKind> options={kindOptions} value={kind} onChange={onKindChange} />
      <SortSection<WorldLinksSort> options={sortOptions} value={sort} onChange={onSortChange} />
    </View>
  );
}
