// Convenient map (Epic #1166): clustered pins for every world, filter chips, near me,
// search-this-area, list/map toggle and a preview sheet using the unified listing card.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { iconSize, spacing, useTheme, Text } from '@kc/ui';
import { MirroredIcon } from '../ui/MirroredIcon';
import {
  LOD_REGION,
  MARKETPLACE_WORLD_SLUGS,
  boundsContain,
  clusterPins,
  pinDistanceKm,
  expandRegion,
  isStackedCluster,
  mapWorldColor,
  regionForPoints,
  regionToBounds,
  validMapPins,
  type MapBounds,
  type MapPinCluster,
  type MapRegion,
  type MarketplaceBrowseRow,
  type MarketplaceMapPin,
} from '@kc/domain';
import { marketplaceRepository } from '../../services/marketplaceComposition';
import { ListingCard } from '../cards/ListingCard';
import { kcGridCell } from '../cards/KcCard.styles';
import { KcFlashList } from '../lists/KcFlashList';
import { useMyLocation } from '../../hooks/useMyLocation';
import { useShellTabBarScrollInset } from '../../navigation/useShellTabBarVisibility';
import { KcMap } from './KcMap';
import type { KcMapFocus } from './KcMap.types';
import { useMapExplorerStyles } from './MapExplorer.styles';

type Mode = 'map' | 'list';
const NEAR_ME_DELTA = 0.04;

export function pinToBrowseRow(p: MarketplaceMapPin, from: { lat: number; lng: number } | null): MarketplaceBrowseRow {
  return {
    listingId: p.listingId,
    worldSlug: p.worldSlug,
    kindSlug: p.kindSlug,
    direction: p.direction,
    title: p.title,
    summary: p.summary,
    urgencyLevel: 0,
    availabilityStatus: 'available',
    cityId: null,
    distanceKm: from ? pinDistanceKm(from, p) : null,
    ride: p.ride,
  };
}

export function MapExplorer({ initialWorld = null }: Readonly<{ initialWorld?: string | null }>) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMapExplorerStyles();
  const bottomInset = useShellTabBarScrollInset();
  const loc = useMyLocation();

  const [mode, setMode] = useState<Mode>('map');
  const [world, setWorld] = useState<string | null>(initialWorld);
  const [region, setRegion] = useState<MapRegion>(LOD_REGION);
  const [pins, setPins] = useState<MarketplaceMapPin[]>([]);
  const [loaded, setLoaded] = useState<MapBounds | null>(null);
  const [loading, setLoading] = useState(false);
  const [selection, setSelection] = useState<readonly MarketplaceMapPin[] | null>(null);
  const [focus, setFocus] = useState<KcMapFocus | null>(null);
  const reqId = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async (r: MapRegion, w: string | null) => {
    const id = ++reqId.current;
    const bounds = regionToBounds(expandRegion(r));
    setLoading(true);
    try {
      const rows = await marketplaceRepository().mapPins({ ...bounds, worldSlug: w, limit: 400 });
      if (!mounted.current || id !== reqId.current) return;
      setPins(validMapPins(rows));
      setLoaded(bounds);
    } catch {
      // A failed fetch keeps the current pins; the "search this area" pill lets the user retry.
    } finally {
      if (mounted.current && id === reqId.current) setLoading(false);
    }
  }, []);

  const flyTo = useCallback((r: MapRegion) => setFocus((f) => ({ region: r, nonce: (f?.nonce ?? 0) + 1 })), []);

  // First load around Lod; reload when the world filter changes.
  useEffect(() => {
    setSelection(null);
    void load(region, world);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, load]);

  // If location permission was granted before, center on the user once.
  useEffect(() => {
    if (!loc.initial) return;
    const r = { latitude: loc.initial.lat, longitude: loc.initial.lng, latitudeDelta: NEAR_ME_DELTA, longitudeDelta: NEAR_ME_DELTA };
    flyTo(r);
    setRegion(r);
    void load(r, world);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.initial]);

  const nearMe = useCallback(async () => {
    const c = await loc.locate();
    if (!c) return;
    const r = { latitude: c.lat, longitude: c.lng, latitudeDelta: NEAR_ME_DELTA, longitudeDelta: NEAR_ME_DELTA };
    flyTo(r);
    setRegion(r);
    void load(r, world);
  }, [flyTo, load, loc, world]);

  const clusters = useMemo(() => clusterPins(pins, region), [pins, region]);
  const moved = loaded != null && !boundsContain(loaded, regionToBounds(region));
  const origin = loc.coords ?? { lat: region.latitude, lng: region.longitude };
  const visible = useMemo(() => {
    const b = regionToBounds(region);
    return pins
      .filter((p) => p.lat >= b.swLat && p.lat <= b.neLat && p.lng >= b.swLng && p.lng <= b.neLng)
      .map((p) => pinToBrowseRow(p, origin))
      .sort((a, b2) => (a.distanceKm ?? 0) - (b2.distanceKm ?? 0));
  }, [pins, region, origin.lat, origin.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPressCluster = useCallback(
    (c: MapPinCluster) => {
      if (c.pins.length === 1 || isStackedCluster(c)) {
        setSelection(c.pins);
        return;
      }
      const r = regionForPoints(c.pins, 0.004);
      if (r) flyTo(r);
    },
    [flyTo],
  );

  const selectedRide = selection?.length === 1 ? selection[0]!.route : null;
  const openListing = (id: string) => router.push(`/(tabs)/donations/marketplace/${id}`);

  const chips: Array<string | null> = [null, ...MARKETPLACE_WORLD_SLUGS];

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          {router.canGoBack() ? (
            <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('marketplace.mapBack')}>
              <MirroredIcon name="chevron-back" size={iconSize['2xl']} color={colors.textPrimary} />
            </Pressable>
          ) : null}
          <Text style={styles.title}>{t('marketplace.mapTitle')}</Text>
        </View>
        <View style={styles.toggle} accessibilityRole="tablist">
          {(['map', 'list'] as const).map((m) => (
            <Pressable
              key={m}
              onPress={() => setMode(m)}
              style={[styles.toggleBtn, mode === m && styles.toggleBtnActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: mode === m }}
            >
              <Ionicons name={m === 'map' ? 'map-outline' : 'list-outline'} size={iconSize.sm} color={mode === m ? colors.textInverse : colors.textPrimary} />
              <Text style={[styles.toggleText, mode === m && styles.toggleTextActive]}>{t(m === 'map' ? 'marketplace.mapModeMap' : 'marketplace.mapModeList')}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipsBar}>
        {chips.map((slug) => {
          const active = world === slug;
          const color = mapWorldColor(slug);
          return (
            <Pressable
              key={slug ?? 'all'}
              onPress={() => setWorld(slug)}
              style={[styles.chip, active && { backgroundColor: color, borderColor: color }]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              {slug ? <View style={[styles.dot, { backgroundColor: active ? colors.textInverse : color }]} /> : null}
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {slug ? t(`marketplace.world.${slug}`, { defaultValue: slug }) : t('marketplace.allWorlds')}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {mode === 'map' ? (
        <View style={styles.mapWrap}>
          <KcMap
            initialRegion={LOD_REGION}
            clusters={clusters}
            selectedId={selection?.length === 1 ? selection[0]!.listingId : null}
            route={selectedRide}
            userLocation={loc.coords}
            focus={focus}
            onRegionChange={setRegion}
            onPressCluster={onPressCluster}
            onPressMap={() => setSelection(null)}
          />

          {moved && !loading ? (
            <Pressable style={styles.searchArea} onPress={() => void load(region, world)} accessibilityRole="button">
              <Ionicons name="refresh" size={iconSize.sm} color={colors.textInverse} />
              <Text style={styles.searchAreaText}>{t('marketplace.mapSearchArea')}</Text>
            </Pressable>
          ) : null}
          {loading ? <ActivityIndicator style={styles.loader} color={colors.primary} /> : null}
          {!loading && pins.length === 0 ? (
            <View style={styles.emptyPill}>
              <Text style={styles.emptyText}>{t('marketplace.mapEmpty')}</Text>
            </View>
          ) : null}

          <Pressable
            style={[styles.fab, { bottom: (selection ? 290 : 24) + bottomInset }]}
            onPress={() => void nearMe()}
            accessibilityRole="button"
            accessibilityLabel={t('marketplace.mapNearMe')}
          >
            {loc.status === 'locating' ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Ionicons name="locate" size={iconSize.xl} color={colors.primary} />
            )}
          </Pressable>
          {loc.status === 'denied' ? (
            <View style={[styles.notice, { bottom: (selection ? 290 : 24) + bottomInset }]}>
              <Text style={styles.noticeText}>{t('marketplace.mapLocationDenied')}</Text>
            </View>
          ) : null}

          {selection ? (
            <View style={[styles.sheet, { paddingBottom: spacing.md + bottomInset }]}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>
                  {selection.length > 1 ? t('marketplace.clusterLabel', { count: selection.length }) : t('marketplace.mapPreview')}
                </Text>
                <Pressable onPress={() => setSelection(null)} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('marketplace.mapClose')}>
                  <Ionicons name="close" size={iconSize.xl} color={colors.textSecondary} />
                </Pressable>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sheetCards}>
                {selection.map((p) => (
                  <ListingCard key={p.listingId} item={pinToBrowseRow(p, origin)} variant="tile" onPress={() => openListing(p.listingId)} />
                ))}
              </ScrollView>
            </View>
          ) : null}
        </View>
      ) : (
        <KcFlashList
          data={visible}
          numColumns={2}
          keyExtractor={(r) => r.listingId}
          contentContainerStyle={{ paddingBottom: bottomInset + spacing.base, paddingHorizontal: spacing.sm }}
          ListHeaderComponent={
            <Text style={styles.listHeader}>{t('marketplace.mapListHeader', { count: visible.length })}</Text>
          }
          ListEmptyComponent={<Text style={styles.listEmpty}>{t('marketplace.mapEmpty')}</Text>}
          renderItem={({ item }) => (
            <View style={kcGridCell}>
              <ListingCard item={item} onPress={() => openListing(item.listingId)} />
            </View>
          )}
        />
      )}
    </View>
  );
}
