// Guest read-only map: pins only (no list mode, filters or write actions). FR-AUTH-014 AC7.
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  LOD_REGION,
  clusterPins,
  regionToBounds,
  type MapRegion,
  type MarketplaceMapPin,
} from '@kc/domain';
import { Text, radius, spacing, typography, useTheme } from '@kc/ui';
import { listGuestMapPins } from '../../services/guestBrowseComposition';
import { KcMap } from '../../components/map/KcMap';
import { textAlignStart } from '../../lib/rtlLayout';

function toMarketplacePin(p: {
  postId: string; lat: number; lng: number; worldSlug: string; direction: string;
}): MarketplaceMapPin {
  return {
    listingId: p.postId,
    worldSlug: p.worldSlug,
    kindSlug: '',
    direction: p.direction === 'request' ? 'request' : 'give',
    title: '',
    summary: null,
    lat: p.lat,
    lng: p.lng,
    route: null,
    ride: null,
  };
}

export function GuestMapScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const alignment = textAlignStart();
  const [region, setRegion] = useState<MapRegion>(LOD_REGION);
  const bounds = useMemo(() => {
    const b = regionToBounds(region);
    return { west: b.swLng, south: b.swLat, east: b.neLng, north: b.neLat };
  }, [region]);

  const pinsQuery = useQuery({
    queryKey: ['guest-map-pins', bounds],
    queryFn: () => listGuestMapPins.execute({ bounds, limit: 100 }),
    staleTime: 30_000,
  });

  const pins = useMemo(
    () => (pinsQuery.data ?? []).map(toMarketplacePin),
    [pinsQuery.data],
  );
  const clusters = useMemo(() => clusterPins(pins, region), [pins, region]);

  const onPressCluster = useCallback(
    (c: { pins: readonly MarketplaceMapPin[] }) => {
      const first = c.pins[0];
      if (first) {
        router.push({ pathname: '/browse/post/[id]', params: { id: first.listingId } });
      }
    },
    [router],
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ padding: spacing.md, gap: spacing.sm }}>
        <Pressable
          accessibilityRole="link"
          testID="guest-map-back"
          onPress={() => router.replace('/browse')}
        >
          <Text style={{ color: colors.primary }}>{t('auth.guestBack')}</Text>
        </Pressable>
        <Text
          accessibilityRole="header"
          style={{ ...typography.h2, color: colors.textPrimary, textAlign: alignment }}
        >
          {t('auth.guestMapTitle')}
        </Text>
        <Text style={{ ...typography.body, color: colors.textSecondary, textAlign: alignment }}>
          {t('auth.guestMapReadOnly')}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <KcMap
          initialRegion={LOD_REGION}
          clusters={clusters}
          selectedId={null}
          route={null}
          userLocation={null}
          focus={null}
          onRegionChange={setRegion}
          onPressCluster={onPressCluster}
          onPressMap={() => {}}
        />
        {pinsQuery.isPending ? (
          <ActivityIndicator
            style={{ position: 'absolute', top: spacing.lg, alignSelf: 'center' }}
            color={colors.primary}
          />
        ) : null}
        {pinsQuery.isError ? (
          <View style={{ position: 'absolute', bottom: spacing.xl, alignSelf: 'center', padding: spacing.md }}>
            <Pressable accessibilityRole="button" onPress={() => { void pinsQuery.refetch(); }}>
              <Text style={{ color: colors.primary }}>{t('general.retry')}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        testID="guest-sign-in"
        onPress={() => router.push('/(auth)')}
        style={{
          margin: spacing.md,
          padding: spacing.md,
          borderRadius: radius.md,
          backgroundColor: colors.primary,
        }}
      >
        <Text style={{ ...typography.button, textAlign: 'center', color: colors.textInverse }}>
          {t('auth.guestSignIn')}
        </Text>
      </Pressable>
    </SafeAreaView>
  );
}
