// "Other dates" on an occurrence of a recurring ride (FR-RIDE-046): every upcoming date of the
// series as a chip; the one on screen is marked, a tap opens another day's ride so the member
// books the day they need. Nothing on a single ride.
import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { he as dateFnsHe } from 'date-fns/locale/he';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { readRideSeriesMarker, type RideSeriesOccurrence } from '@kc/domain';
import { rideSeriesOccurrencesQueryKey, rideSeriesUseCases } from '../../services/rideSeriesComposition';
import { SearchChip } from '../search/SearchChip';

interface Props {
  readonly listingId: string;
  readonly details: Record<string, unknown>;
}

/** "Mon 3/11", with "full" appended when an offer has no seat left. */
function chipLabel(o: RideSeriesOccurrence, t: (key: string) => string): string {
  const day = format(new Date(o.departsAt), 'EEE d/M', { locale: dateFnsHe });
  return o.seatsLeft === 0 ? `${day} · ${t('rideFeed.full')}` : day;
}

export function RideSeriesOccurrences({ listingId, details }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  const series = readRideSeriesMarker(details);
  const dates = useQuery({
    queryKey: rideSeriesOccurrencesQueryKey(series?.id ?? ''),
    queryFn: () => rideSeriesUseCases.listOccurrences().execute(series?.id ?? ''),
    enabled: series !== null,
  });

  const list = dates.data ?? [];
  if (!series || list.length < 2) return null;

  return (
    <View style={styles.box} testID="ride-series-occurrences">
      <Text style={styles.title}>{t('rideSeries.otherDates')}</Text>
      <View style={styles.chips}>
        {list.map((o) => (
          <SearchChip
            key={o.listingId}
            label={chipLabel(o, t)}
            active={o.listingId === listingId}
            onPress={() => {
              if (o.listingId === listingId) return;
              router.push({ pathname: '/listing/[listingId]', params: { listingId: o.listingId } });
            }}
          />
        ))}
      </View>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  box: { gap: spacing.sm },
  title: { ...typography.label, color: colors.textSecondary },
  chips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
}));
