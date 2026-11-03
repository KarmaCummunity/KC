// Rides hub: pick from/to official places (D71) → PostGIS corridor match (find_ride_listing_matches, 0392).
import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import type { RidePlace } from '@kc/domain';
import { worldHubBaseStyles } from './worldHubStyles';
import { RidePlaceField } from './RidePlaceField';
import { RideRouteFollow } from './RideRouteFollow';
import { SavedRideRoutesList } from './SavedRideRoutesList';
import { ridesKnowledgeRpcs } from '../../services/ridesKnowledgeComposition';
import { useRidePlaces } from '../../hooks/useRidePlaces';
import { useAuthStore } from '../../store/authStore';
import { hapticLightTap } from '../../lib/haptics';
import { cleanDisplayTitle } from '../../lib/displayTitle';
import { KcRowCard } from '../cards/KcRowCard';

const useStyles = makeUseStyles(({ colors }) => ({
  ...worldHubBaseStyles(colors),
  box: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  title: { ...typography.h3, color: colors.textPrimary },
  label: { ...typography.caption, color: colors.textSecondary },
  results: { marginTop: spacing.sm },
}));

export function RideMatchSearch() {
  const { t, i18n } = useTranslation();
  const styles = useStyles();
  const router = useRouter();
  const places = useRidePlaces();
  const signedIn = useAuthStore((s) => Boolean(s.session?.userId));
  const [a, setFrom] = useState<RidePlace | null>(null);
  const [b, setTo] = useState<RidePlace | null>(null);
  const field = {
    places: places.data ?? null,
    isLoading: places.isLoading,
    error: places.error,
    onRetry: () => void places.refetch(),
  };

  const pick = (set: typeof setFrom, place: RidePlace) => {
    hapticLightTap();
    set(place);
  };

  const matches = useQuery({
    queryKey: ['ride-matches', a?.kind, a?.id, b?.kind, b?.id],
    enabled: Boolean(a && b),
    queryFn: () =>
      ridesKnowledgeRpcs.findMatches({
        originLat: a!.lat, originLng: a!.lng, destLat: b!.lat, destLng: b!.lng, radiusKm: 15,
      }),
    staleTime: 30_000,
  });

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <View style={styles.box}>
      <Text style={styles.title}>{t('donations.rides.matchTitle')}</Text>
      <RidePlaceField label={t('ridePlaces.fieldOrigin')} value={a} onChange={(p) => pick(setFrom, p)} {...field} />
      <RidePlaceField label={t('ridePlaces.fieldDest')} value={b} onChange={(p) => pick(setTo, p)} {...field} />
      {a && b && signedIn ? <RideRouteFollow key={`${a.kind}:${a.id}>${b.kind}:${b.id}`} origin={a} dest={b} /> : null}
      <SavedRideRoutesList />
      {a && b && matches.data ? (
        <View style={styles.results}>
          {matches.data.length === 0 ? <Text style={styles.label}>{t('donations.rides.empty')}</Text> : null}
          {matches.data.map((m) => (
            <KcRowCard
              key={m.listing_id}
              testID={`ride-match-${m.listing_id}`}
              tone="give"
              badgeLabel={t('cards.rideOffer')}
              placeholderIcon="car-outline"
              title={cleanDisplayTitle(m.title)}
              meta={[
                `${[m.origin_label, m.dest_label].filter(Boolean).join(' → ')} · ${fmt(m.departs_at)} · ${t('donations.rides.seats', { count: m.seats_left })}`,
              ]}
              onPress={() =>
                router.push({
                  pathname: '/(tabs)/donations/marketplace/[listingId]',
                  params: { listingId: m.listing_id },
                } as never)
              }
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
