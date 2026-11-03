// FeedFilterIcon — the filter/sort entry-point that lives in the TopBar
// only while the Home Feed is active. Tag with the active-filter count when
// >0 (FR-FEED-004 / replaces the deprecated FR-FEED-013 in-feed chip).
// Absorbed into shared filterKit (issue #1457).

import React from 'react';
import { FilterButton, type FilterButtonProps } from './filterKit/FilterButton';

export type FeedFilterIconProps = FilterButtonProps;

export function FeedFilterIcon(props: FeedFilterIconProps) {
  return <FilterButton {...props} />;
}
