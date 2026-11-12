// "My recurring rides" (docs/spec/05_giving_worlds.md §5.3 step 1, FR-RIDE-046): every
// series the member runs, with pause / resume, reschedule and cancel. The server keeps the
// occurrences in step: a paused series drops its upcoming unbooked rides and keeps a booked one;
// a cancelled series ends every upcoming ride and tells the booked passengers (FR-RIDE-046 AC6).
import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { readRideRoute, type RideSeries } from '@kc/domain';
import { MY_RIDE_SERIES_QUERY_KEY, rideSeriesUseCases } from '../../services/rideSeriesComposition';
import { RIDES_FEED_QUERY_KEY } from '../../services/ridesFeedComposition';
import { handoffErrorKey } from '../../lib/marketplaceCreateErrors';
import { rideSeriesLabel, rideSeriesUntilLabel } from '../../lib/rides/rideSeriesLabel';
import { hapticSuccess } from '../../lib/haptics';
import { useShellTabBarScrollInset } from '../../navigation/useShellTabBarVisibility';
import { Screen } from '../ui/Screen';
import { WorldSubScreenChrome } from './useWorldHeader';
import { KcRowCard } from '../cards/KcRowCard';
import { DangerButton, GhostButton, SecondaryButton } from '../ui/Buttons';
import { RideSeriesScheduleEditor } from './RideSeriesScheduleEditor';

export function MyRideSeriesList() {
  const { t } = useTranslation();
  const styles = useStyles();
  const inset = useShellTabBarScrollInset();
  const series = useQuery({ queryKey: MY_RIDE_SERIES_QUERY_KEY, queryFn: () => rideSeriesUseCases.listMine().execute() });
  const list = series.data ?? [];

  return (
    <>
      <WorldSubScreenChrome worldSlug="rides" activeScreenTestId="world-hub-ride-series" />
      <Screen blobs="off" hasNativeHeader>
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: inset }]} testID="ride-series-list">
          {list.map((s) => <SeriesRow key={s.id} series={s} />)}
          {!series.isLoading && list.length === 0 ? (
            <Text style={styles.empty}>{t(series.isError ? 'rideSeries.error' : 'rideSeries.empty')}</Text>
          ) : null}
        </ScrollView>
      </Screen>
    </>
  );
}

/** Runs one series action: busy state, success haptic, cache refresh, friendly error copy. */
function useSeriesAction() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>, successKey?: string) => {
    setBusy(true);
    try {
      await action();
      hapticSuccess();
      // The series list, the rides feed and any occurrence screen already open.
      await Promise.all([
        qc.invalidateQueries({ queryKey: MY_RIDE_SERIES_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: RIDES_FEED_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: ['marketplace'] }),
      ]);
      if (successKey) alert(t(successKey));
    } catch (err) {
      alert(t(handoffErrorKey(err) ?? 'rideSeries.errors.generic'));
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function SeriesRow({ series }: Readonly<{ series: RideSeries }>) {
  const { t } = useTranslation();
  const styles = useStyles();
  const { busy, run } = useSeriesAction();
  const [editing, setEditing] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const route = readRideRoute(series.details);
  const paused = series.status === 'paused';

  const setStatus = (status: 'active' | 'paused' | 'cancelled') =>
    run(() => rideSeriesUseCases.setStatus().execute(series.id, status));

  const actions = confirmingCancel ? (
    <View style={styles.confirm} testID={`ride-series-cancel-confirm-${series.id}`}>
      <Text style={styles.question}>{t('rideSeries.cancelConfirm')}</Text>
      <View style={styles.actions}>
        <DangerButton
          testID={`ride-series-cancel-yes-${series.id}`}
          size="sm"
          label={t('rideSeries.cancelYes')}
          loading={busy}
          onPress={() => void setStatus('cancelled').then(() => setConfirmingCancel(false))}
        />
        <GhostButton size="sm" label={t('rideSeries.keep')} disabled={busy} onPress={() => setConfirmingCancel(false)} />
      </View>
    </View>
  ) : (
    <View style={styles.actions}>
      <SecondaryButton
        testID={`ride-series-${paused ? 'resume' : 'pause'}-${series.id}`}
        size="sm"
        icon={paused ? 'play-outline' : 'pause-outline'}
        label={t(paused ? 'rideSeries.resume' : 'rideSeries.pause')}
        disabled={busy}
        onPress={() => void setStatus(paused ? 'active' : 'paused')}
      />
      <GhostButton
        testID={`ride-series-edit-${series.id}`}
        size="sm"
        icon="time-outline"
        label={t('rideSeries.reschedule')}
        disabled={busy}
        onPress={() => setEditing((v) => !v)}
      />
      <DangerButton
        testID={`ride-series-cancel-${series.id}`}
        size="sm"
        label={t('rideSeries.cancel')}
        disabled={busy}
        onPress={() => setConfirmingCancel(true)}
      />
    </View>
  );

  return (
    <KcRowCard
      testID={`ride-series-row-${series.id}`}
      containerStyle={styles.row}
      tone={series.direction === 'give' ? 'give' : 'request'}
      badgeLabel={t(series.direction === 'give' ? 'cards.rideOffer' : 'cards.rideRequest')}
      placeholderIcon="repeat-outline"
      title={route.origin && route.dest ? `${route.origin.label} → ${route.dest.label}` : series.title}
      meta={[rideSeriesLabel(series.schedule, t), rideSeriesUntilLabel(series.schedule.endsOn, t)]}
      statusLabel={paused ? t('rideSeries.status.paused') : null}
      footer={
        <View style={styles.footer}>
          {actions}
          {editing ? (
            <RideSeriesScheduleEditor
              series={series}
              busy={busy}
              onSave={(schedule, duration) =>
                run(() => rideSeriesUseCases.updateSchedule().execute(series.id, schedule, duration), 'rideSeries.saved')
                  .then(() => setEditing(false))
              }
              onClose={() => setEditing(false)}
            />
          ) : null}
        </View>
      }
    />
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  list: { paddingVertical: spacing.md, gap: spacing.sm },
  row: { marginHorizontal: spacing.lg },
  footer: { gap: spacing.sm, paddingTop: spacing.sm },
  actions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
  confirm: { gap: spacing.sm },
  question: { ...typography.body, color: colors.textPrimary },
  empty: { ...typography.body, color: colors.textSecondary, padding: spacing.lg, textAlign: 'center' as const },
}));
