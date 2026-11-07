// Mapped to spec: FR-FEED-020 AC2 — the rides world's filter sheet parts: the offers / requests
// chip row and a titled section. The other worlds use the main feed's `PostFilterSheet`.
// Rebuilt on top of the shared filterKit (issue #1457).
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { FilterChipRow } from '../filterKit/FilterChipRow';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import type { WorldFeedDirection } from '../../lib/worldFeed';

const useStyles = makeUseStyles(({ colors }) => ({
  section: { gap: spacing.xs },
  sectionTitle: { ...typography.label, color: colors.textPrimary, textAlign: rtlTextAlignStart },
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

/** A titled block inside a world's filter sheet. */
export function WorldFilterSection({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}
