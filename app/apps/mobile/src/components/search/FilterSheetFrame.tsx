// Shared frame of the filter sheets (search, rides): a kit `BottomSheet` with a
// title and a footer that applies or clears the draft filters (spec 17 §4.1).
// Absorbed into shared filterKit (issue #1457).

import React from 'react';
import {
  FilterSheetFrame as KitFilterSheetFrame,
  type FilterSheetFrameProps as KitFilterSheetFrameProps,
} from '../filterKit/FilterSheetFrame';

export type FilterSheetFrameProps = KitFilterSheetFrameProps;

export function FilterSheetFrame(props: FilterSheetFrameProps) {
  return <KitFilterSheetFrame {...props} />;
}
