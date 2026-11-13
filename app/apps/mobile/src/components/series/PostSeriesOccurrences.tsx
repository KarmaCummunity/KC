// "Other dates" on a date of a recurring event (FR-POST-024): every upcoming date of the series
// as a chip; the one on screen is marked, a tap opens another date so the member registers for
// the day they want. The owner also gets the way to the series screen. Nothing on a single event.
import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { he as dateFnsHe } from 'date-fns/locale/he';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { readPostSeriesMarker } from '@kc/domain';
import { postSeriesOccurrencesQueryKey, postSeriesUseCases } from '../../services/postSeriesComposition';
import { SearchChip } from '../search/SearchChip';
import { GhostButton } from '../ui/Buttons';

interface Props {
  /** The date on screen (a listing id is its post id). */
  readonly listingId: string;
  readonly details: Record<string, unknown>;
  /** The viewer owns the event, so the series screen is theirs to open. */
  readonly isOwner: boolean;
}

export function PostSeriesOccurrences({ listingId, details, isOwner }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  const series = readPostSeriesMarker(details);
  const dates = useQuery({
    queryKey: postSeriesOccurrencesQueryKey(series?.id ?? ''),
    queryFn: () => postSeriesUseCases.listOccurrences().execute(series?.id ?? ''),
    enabled: series !== null,
  });

  if (!series) return null;
  const list = dates.data ?? [];

  return (
    <View style={styles.box} testID="post-series-occurrences">
      {list.length >= 2 ? (
        <>
          <Text style={styles.title}>{t('postSeries.otherDates')}</Text>
          <View style={styles.chips}>
            {list.map((date) => (
              <SearchChip
                key={date.postId}
                label={format(new Date(date.startsAt), 'EEE d/M', { locale: dateFnsHe })}
                active={date.postId === listingId}
                onPress={() => {
                  if (date.postId === listingId) return;
                  router.push({ pathname: '/listing/[listingId]', params: { listingId: date.postId } });
                }}
              />
            ))}
          </View>
        </>
      ) : null}
      {isOwner ? (
        <GhostButton
          testID="post-series-manage"
          size="md"
          icon="repeat-outline"
          label={t('postSeries.manage')}
          onPress={() => router.push('/(tabs)/donations/time/series')}
        />
      ) : null}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  box: { gap: spacing.sm },
  title: { ...typography.label, color: colors.textSecondary },
  chips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
}));
