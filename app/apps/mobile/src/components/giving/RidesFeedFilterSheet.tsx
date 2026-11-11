// Mapped to spec: FR-FEED-020 AC2 / FR-RIDE-002 — the rides world's search / filter sheet: the
// route search plus the offers / requests filter, on the same frame as every world's sheet.
import React from 'react';
import { useTranslation } from 'react-i18next';
import { FilterSheetFrame } from '../filterKit/FilterSheetFrame';
import { WorldFeedDirectionChips, WorldFilterSection } from './WorldFeedControls';
import { RideRouteFilter } from './RideRouteFilter';
import type { RidesHubFeedState } from '../../hooks/useRidesHubFeed';

/** Compact cap so the feed stays visible behind the sheet, as on the main feed. */
const WORLD_FILTER_SHEET_MAX_HEIGHT = '70%';

interface Props {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly feed: RidesHubFeedState;
}

export function RidesFeedFilterSheet({ visible, onClose, feed }: Props) {
  const { t } = useTranslation();
  return (
    <FilterSheetFrame
      visible={visible}
      onDismiss={onClose}
      title={t('donations.worldFeed.filtersTitle')}
      maxHeight={WORLD_FILTER_SHEET_MAX_HEIGHT}
      onClear={() => {
        feed.clear();
        onClose();
      }}
    >
      <WorldFilterSection title={t('donations.worldFeed.sectionRoute')}>
        <RideRouteFilter filter={feed} />
      </WorldFilterSection>
      <WorldFilterSection title={t('donations.worldFeed.sectionDirection')}>
        <WorldFeedDirectionChips value={feed.direction} onChange={feed.setDirection} />
      </WorldFilterSection>
    </FilterSheetFrame>
  );
}
