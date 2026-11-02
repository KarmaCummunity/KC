// Mapped to spec: FR-FEED-020 AC2 — the controls above a giving world's feed: search within
// the world, the offers / requests filter, and the world's subcategory + distance chips.
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing } from '@kc/ui';
import { TextField } from '../ui/TextField';
import { Chip } from '../ui/Chip';
import { BrowseRefineChips } from '../marketplace/BrowseRefineChips';
import type { WorldFeedDirection } from '../../lib/worldFeed';
import type { WorldFeedState } from '../../hooks/useWorldFeed';

const useStyles = makeUseStyles(() => ({
  root: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  row: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
}));

/** Direction chips in display order; literal testIDs keep the Maestro contract checkable. */
const DIRECTION_CHIPS: ReadonlyArray<{ direction: WorldFeedDirection; labelKey: string; testID: string }> = [
  { direction: 'all', labelKey: 'donations.worldFeed.directionAll', testID: 'world-feed-direction-all' },
  { direction: 'give', labelKey: 'donations.worldFeed.directionGive', testID: 'world-feed-direction-give' },
  { direction: 'request', labelKey: 'donations.worldFeed.directionRequest', testID: 'world-feed-direction-request' },
];

interface Props {
  readonly worldSlug: string;
  readonly feed: WorldFeedState;
}

export function WorldFeedControls({ worldSlug, feed }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  return (
    <View style={styles.root}>
      <TextField
        testID="world-feed-search"
        label={t('donations.worldFeed.searchLabel')}
        placeholder={t('donations.worldFeed.searchPlaceholder')}
        leadingIcon="search-outline"
        value={feed.query}
        onChangeText={feed.setQuery}
        returnKeyType="search"
        autoCorrect={false}
      />
      <View style={styles.row} accessibilityLabel={t('donations.worldFeed.directionRowA11y')}>
        {DIRECTION_CHIPS.map(({ direction, labelKey, testID }) => (
          <Chip
            key={direction}
            testID={testID}
            size="sm"
            label={t(labelKey)}
            selected={feed.direction === direction}
            onPress={() => feed.setDirection(direction)}
          />
        ))}
      </View>
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
