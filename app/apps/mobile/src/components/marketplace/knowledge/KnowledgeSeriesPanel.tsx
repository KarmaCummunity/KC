// Weekly schedule of a recurring lesson offer (FR-KNOW-003 AC2, FR-KNOW-004 AC1, #2479). Everyone
// who sees the offer reads "every Sun, Tue at 18:00 · 60 min"; the giver also sees whether the
// series runs and may pause, resume or end it. The upcoming dates themselves are the slots the
// booking section lists. A one-off offer has no series, and the panel renders nothing.
import React, { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Text } from '@kc/ui';
import { knowledgeSlotSeriesActions, type KnowledgeSlotSeries, type KnowledgeSlotSeriesStatus } from '@kc/domain';
import { knowledgeSeriesQueryKey, knowledgeSeriesUseCases } from '../../../services/knowledgeBookingComposition';
import { rideSeriesLabel, rideSeriesUntilLabel } from '../../../lib/rides/rideSeriesLabel';
import { DangerButton, GhostButton, SecondaryButton } from '../../ui/Buttons';
import { useRideBookingStyles } from '../rides/rideBookingStyles';
import { useKnowledgeBookingAction } from './useKnowledgeBookingAction';

interface Props {
  readonly listingId: string;
  readonly cityId: string | null;
  /** The viewer is the giver: shows the series state and its controls. */
  readonly isOwner: boolean;
}

export function KnowledgeSeriesPanel({ listingId, cityId, isOwner }: Props) {
  const series = useQuery({
    queryKey: knowledgeSeriesQueryKey(listingId),
    queryFn: () => knowledgeSeriesUseCases.get().execute(listingId),
  });
  // Nothing to say while loading, on a failure (the booking section reports those) or for one-off times.
  if (!series.data) return null;
  return <SeriesBox series={series.data} listingId={listingId} cityId={cityId} isOwner={isOwner} />;
}

function SeriesBox({ series, listingId, cityId, isOwner }: Props & { readonly series: KnowledgeSlotSeries }) {
  const { t } = useTranslation();
  const styles = useRideBookingStyles();
  const schedule = [
    rideSeriesLabel({ weekdays: series.weekdays, time: series.startTime }, t),
    t('knowledgeBooking.slotLength', { minutes: series.durationMinutes }),
    rideSeriesUntilLabel(series.endsOn, t),
  ].filter(Boolean).join(' · ');

  return (
    <View style={styles.box} testID="knowledge-series-panel">
      <Text style={styles.title}>{t('knowledgeBooking.series.title')}</Text>
      <Text style={styles.caption} testID="knowledge-series-schedule">{schedule}</Text>
      {isOwner ? <SeriesControls status={series.status} listingId={listingId} cityId={cityId} /> : null}
    </View>
  );
}

/** The giver's state line and the moves the series machine allows; ending asks first. */
function SeriesControls({ status, listingId, cityId }: { status: KnowledgeSlotSeriesStatus; listingId: string; cityId: string | null }) {
  const { t } = useTranslation();
  const styles = useRideBookingStyles();
  const { busy, run } = useKnowledgeBookingAction(listingId, cityId);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const actions = knowledgeSlotSeriesActions(status);
  const move = (next: KnowledgeSlotSeriesStatus) => run(() => knowledgeSeriesUseCases.setStatus().execute(listingId, next));

  return (
    <>
      <Text style={styles.caption} testID="knowledge-series-status">{t(`knowledgeBooking.series.status.${status}`)}</Text>
      {confirmingEnd ? (
        <View testID="knowledge-series-end-confirm">
          <Text style={styles.warning}>{t('knowledgeBooking.series.endConfirm')}</Text>
          <View style={styles.actions}>
            <DangerButton
              testID="knowledge-series-end-yes"
              size="sm"
              label={t('knowledgeBooking.series.endYes')}
              loading={busy}
              onPress={() => void move('ended').then(() => setConfirmingEnd(false))}
            />
            <GhostButton size="sm" label={t('knowledgeBooking.series.keep')} disabled={busy} onPress={() => setConfirmingEnd(false)} />
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          {actions.pause || actions.resume ? (
            <SecondaryButton
              testID={`knowledge-series-${actions.resume ? 'resume' : 'pause'}`}
              size="sm"
              icon={actions.resume ? 'play-outline' : 'pause-outline'}
              label={t(actions.resume ? 'knowledgeBooking.series.resume' : 'knowledgeBooking.series.pause')}
              disabled={busy}
              onPress={() => void move(actions.resume ? 'active' : 'paused')}
            />
          ) : null}
          {actions.end ? (
            <DangerButton
              testID="knowledge-series-end"
              size="sm"
              label={t('knowledgeBooking.series.end')}
              disabled={busy}
              onPress={() => setConfirmingEnd(true)}
            />
          ) : null}
        </View>
      )}
    </>
  );
}
