// Mapped to spec: FR-FEED-021 — the feed on a map: the posts of the feed that opened it (main feed or a
// giving world's feed, with its filter), clustered pins, near me, list/map toggle, a preview sheet.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { iconSize, spacing, useTheme, Text } from '@kc/ui';
import type { PostFeedFilter, PostWithOwner } from '@kc/application';
import {
  LOD_REGION,
  clusterPins,
  isStackedCluster,
  regionForPoints,
  regionToBounds,
  type MapPinCluster,
  type MapRegion,
} from '@kc/domain';
import { MirroredIcon } from '../ui/MirroredIcon';
import { PostCardGrid } from '../PostCardGrid';
import { kcGridCell } from '../cards/KcCard.styles';
import { KcFlashList } from '../lists/KcFlashList';
import { useMyLocation } from '../../hooks/useMyLocation';
import { usePostMapFeed } from '../../hooks/usePostMapFeed';
import { useShellTabBarScrollInset } from '../../navigation/useShellTabBarVisibility';
import { KcMap } from './KcMap';
import type { KcMapFocus } from './KcMap.types';
import { useMapExplorerStyles } from './MapExplorer.styles';

type Mode = 'map' | 'list';
const NEAR_ME_DELTA = 0.04;
const SHEET_CARD_WIDTH = 170;

export function MapExplorer({
  filter,
  headerAction,
}: Readonly<{ filter: PostFeedFilter; headerAction?: React.ReactNode }>) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMapExplorerStyles();
  const bottomInset = useShellTabBarScrollInset();
  const loc = useMyLocation();
  const { posts, pins, isLoading } = usePostMapFeed(filter);

  const [mode, setMode] = useState<Mode>('map');
  const [region, setRegion] = useState<MapRegion>(LOD_REGION);
  const [selection, setSelection] = useState<readonly string[] | null>(null);
  const [focus, setFocus] = useState<KcMapFocus | null>(null);
  const flyTo = useCallback((r: MapRegion) => setFocus((f) => ({ region: r, nonce: (f?.nonce ?? 0) + 1 })), []);
  const placed = useRef(false);

  // Centre once: on the user when location was granted before, else around the feed's posts.
  useEffect(() => {
    if (placed.current) return;
    if (loc.initial) {
      placed.current = true;
      flyTo({ latitude: loc.initial.lat, longitude: loc.initial.lng, latitudeDelta: NEAR_ME_DELTA, longitudeDelta: NEAR_ME_DELTA });
      return;
    }
    const fit = regionForPoints(pins);
    if (fit) {
      placed.current = true;
      flyTo(fit);
    }
  }, [loc.initial, pins, flyTo]);

  const nearMe = useCallback(async () => {
    const c = await loc.locate();
    if (c) flyTo({ latitude: c.lat, longitude: c.lng, latitudeDelta: NEAR_ME_DELTA, longitudeDelta: NEAR_ME_DELTA });
  }, [flyTo, loc]);

  const clusters = useMemo(() => clusterPins(pins, region), [pins, region]);
  const byId = useMemo(() => new Map(posts.map((p) => [p.postId, p])), [posts]);
  const selected = useMemo(
    () => (selection ?? []).map((id) => byId.get(id)).filter((p): p is PostWithOwner => !!p),
    [selection, byId],
  );
  const visible = useMemo(() => {
    const b = regionToBounds(region);
    const inView = new Set(
      pins.filter((p) => p.lat >= b.swLat && p.lat <= b.neLat && p.lng >= b.swLng && p.lng <= b.neLng).map((p) => p.listingId),
    );
    return posts.filter((p) => inView.has(p.postId));
  }, [pins, posts, region]);

  const onPressCluster = useCallback(
    (c: MapPinCluster) => {
      if (c.pins.length === 1 || isStackedCluster(c)) {
        setSelection(c.pins.map((p) => p.listingId));
        return;
      }
      const r = regionForPoints(c.pins, 0.004);
      if (r) flyTo(r);
    },
    [flyTo],
  );

  const sheetBottom = (selection ? 290 : 24) + bottomInset;

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
          {headerAction}
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

      {mode === 'map' ? (
        <View style={styles.mapWrap}>
          <KcMap
            initialRegion={LOD_REGION}
            clusters={clusters}
            selectedId={selection?.length === 1 ? selection[0]! : null}
            route={null}
            userLocation={loc.coords}
            focus={focus}
            onRegionChange={setRegion}
            onPressCluster={onPressCluster}
            onPressMap={() => setSelection(null)}
          />
          {isLoading ? <ActivityIndicator style={styles.loader} color={colors.primary} /> : null}
          {!isLoading && pins.length === 0 ? (
            <View style={styles.emptyPill}>
              <Text style={styles.emptyText}>{t('marketplace.mapEmpty')}</Text>
            </View>
          ) : null}

          <Pressable style={[styles.fab, { bottom: sheetBottom }]} onPress={() => void nearMe()} accessibilityRole="button" accessibilityLabel={t('marketplace.mapNearMe')}>
            {loc.status === 'locating' ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="locate" size={iconSize.xl} color={colors.primary} />}
          </Pressable>
          {loc.status === 'denied' ? (
            <View style={[styles.notice, { bottom: sheetBottom }]}>
              <Text style={styles.noticeText}>{t('marketplace.mapLocationDenied')}</Text>
            </View>
          ) : null}

          {selection ? (
            <View style={[styles.sheet, { paddingBottom: spacing.md + bottomInset }]}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>
                  {selected.length > 1 ? t('marketplace.clusterLabel', { count: selected.length }) : t('marketplace.mapPreview')}
                </Text>
                <Pressable onPress={() => setSelection(null)} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('marketplace.mapClose')}>
                  <Ionicons name="close" size={iconSize.xl} color={colors.textSecondary} />
                </Pressable>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sheetCards}>
                {selected.map((p) => (
                  <View key={p.postId} style={{ width: SHEET_CARD_WIDTH }}>
                    <PostCardGrid post={p} />
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : null}
        </View>
      ) : (
        <KcFlashList
          data={visible}
          numColumns={2}
          keyExtractor={(p) => p.postId}
          contentContainerStyle={{ paddingBottom: bottomInset + spacing.base, paddingHorizontal: spacing.sm }}
          ListHeaderComponent={<Text style={styles.listHeader}>{t('marketplace.mapListHeader', { count: visible.length })}</Text>}
          ListEmptyComponent={<Text style={styles.listEmpty}>{t('marketplace.mapEmpty')}</Text>}
          renderItem={({ item }) => (
            <View style={kcGridCell}>
              <PostCardGrid post={item} />
            </View>
          )}
        />
      )}
    </View>
  );
}
