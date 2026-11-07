// Mapped to spec: FR-FEED-020 AC2 — the controls above a giving world's feed: search within
// the world, the offers / requests filter, and the world's subcategory + distance chips.
// `WorldFeedDirectionChips` is exported so the rides feed uses the very same filter row.
// Rebuilt on top of the shared filterKit (issue #1457).
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing } from '@kc/ui';
import { FilterSearchBar } from '../filterKit/FilterSearchBar';
import { FilterChipRow } from '../filterKit/FilterChipRow';
import { BrowseRefineChips } from '../marketplace/BrowseRefineChips';
import type { WorldFeedDirection } from '../../lib/worldFeed';
import type { WorldFeedState } from '../../hooks/useWorldFeed';

const useStyles = makeUseStyles(() => ({
  root: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  searchBar: { marginBottom: 0 },
}));

/** Direction chips in display order; literal testIDs keep the Maestro contract checkable. */
const DIRECTION_CHIPS: ReadonlyArray<{ direction: WorldFeedDirection; labelKey: string; testID: string }> = [
  { direction: 'all', labelKey: 'donations.worldFeed.directionAll', testID: 'world-feed-direction-all' },
  { direction: 'give', labelKey: 'donations.worldFeed.directionGive', testID: 'world-feed-direction-give' },
  { direction: 'request', labelKey: 'donations.worldFeed.directionRequest', testID: 'world-feed-direction-request' },
];

/** The offers / requests chip row shared by every world feed, rides included (#1626). */
export function WorldFeedDirectionChips({
  value,
  onChange,
}: Readonly<{ value: WorldFeedDirection; onChange: (direction: WorldFeedDirection) => void }>) {
  const { t } = useTranslation();
  const options = DIRECTION_CHIPS.map(({ direction, labelKey, testID }) => ({
    value: direction,
    label: t(labelKey),
    testID,
  }));
  return (
    <FilterChipRow<WorldFeedDirection>
      options={options}
      value={value}
      // The row is single-select with no "none": a tap on the selected chip keeps it.
      onChange={(direction) => { if (direction) onChange(direction); }}
      accessibilityLabel={t('donations.worldFeed.directionRowA11y')}
    />
  );
}

interface Props {
  readonly worldSlug: string;
  readonly feed: WorldFeedState;
}

export function WorldFeedControls({ worldSlug, feed }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();

  return (
    <View style={styles.root}>
      <FilterSearchBar
        testID="world-feed-search"
        placeholder={t('donations.worldFeed.searchPlaceholder')}
        accessibilityLabel={t('donations.worldFeed.searchLabel')}
        value={feed.query}
        onChangeText={feed.setQuery}
        style={styles.searchBar}
      />
      <WorldFeedDirectionChips value={feed.direction} onChange={feed.setDirection} />
      {/* A text search spans every subcategory and distance, so these refine browsing only. */}
      {feed.searching ? null : (
        <BrowseRefineChips
          worldSlug={worldSlug}
          categoryId={feed.categoryId}
          onCategoryChange={feed.setCategoryId}
          radiusKm={feed.radiusKm}
          onRadiusChange={feed.setRadiusKm}
        />
      )}
    </View>
  );
}
