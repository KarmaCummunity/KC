// Mapped to spec: FR-FEED-021 — the feed on a map, with the opening feed's filter editable here too.
import React, { useCallback, useMemo, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Screen } from '../../../../src/components/ui/Screen';
import { MapExplorer } from '../../../../src/components/map/MapExplorer';
import { FilterButton } from '../../../../src/components/filterKit/FilterButton';
import { PostFilterSheet, type PostFilterValue } from '../../../../src/components/PostFilterSheet';
import { decodeMapFilter, mapFeedFilter, mapFilterCount } from '../../../../src/lib/postMap';
import { WorldSubScreenChrome } from '../../../../src/components/giving/useWorldHeader';
import { WORLD_MAP_MENU_ID } from '../../../../src/components/giving/worldMenuActive';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function MarketplaceMapScreen() {
  const params = useLocalSearchParams<{ filter?: string; world?: string }>();
  const world = typeof params.world === 'string' && params.world ? params.world : null;
  const [value, setValue] = useState<PostFilterValue>(() => decodeMapFilter(params.filter, world));
  const [sheetOpen, setSheetOpen] = useState(false);
  const feedFilter = useMemo(() => mapFeedFilter(value, world), [value, world]);

  const patch = useCallback(
    (next: Partial<PostFilterValue>) => setValue((prev) => ({ ...prev, ...next, ...(world ? { worlds: [world] } : {}) })),
    [world],
  );
  const clear = useCallback(() => setValue(decodeMapFilter(undefined, world)), [world]);

  return (
    <>
      {world ? (
        <WorldSubScreenChrome worldSlug={world} activeScreenTestId={WORLD_MAP_MENU_ID} />
      ) : null}
      <Screen scroll={false} blobs="off" tabBarInset={false} hasNativeHeader>
      <MapExplorer
        filter={feedFilter}
        headerAction={
          <FilterButton testID="map-filter-button" activeCount={mapFilterCount(value, world)} onPress={() => setSheetOpen(true)} />
        }
      />
      <PostFilterSheet
        visible={sheetOpen}
        value={value}
        onPatch={patch}
        onClear={clear}
        onClose={() => setSheetOpen(false)}
        lockedWorld={world !== null}
      />
      </Screen>
    </>
  );
}
