// One recurring event on the owner's series screen (FR-POST-024 AC5–AC8): its schedule, the
// actions its status allows (read from the series machine), the time editor, and its upcoming
// dates, each of which can be cancelled on its own.
import React, { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { he as dateFnsHe } from 'date-fns/locale/he';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { postSeriesActions, type PostSeries, type PostSeriesOccurrence } from '@kc/domain';
import { postSeriesOccurrencesQueryKey, postSeriesUseCases } from '../../services/postSeriesComposition';
import { rideSeriesLabel, rideSeriesUntilLabel } from '../../lib/rides/rideSeriesLabel';
import { KcRowCard } from '../cards/KcRowCard';
import { DangerButton, GhostButton, SecondaryButton } from '../ui/Buttons';
import { PostSeriesScheduleEditor } from './PostSeriesScheduleEditor';

interface Props {
  readonly series: PostSeries;
  readonly busy: boolean;
  /** Runs one series action with the screen's busy state, cache refresh and error copy. */
  readonly run: (action: () => Promise<unknown>, successKey?: string) => Promise<void>;
}

/** What the owner is being asked to confirm: ending the series, or cancelling one date. */
type Confirming = { readonly kind: 'end' } | { readonly kind: 'date'; readonly date: PostSeriesOccurrence } | null;

const dayLabel = (iso: string): string => format(new Date(iso), 'EEEE d/M', { locale: dateFnsHe });

export function PostSeriesRow({ series, busy, run }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const actions = postSeriesActions(series.status);
  const dates = useQuery({
    queryKey: postSeriesOccurrencesQueryKey(series.id),
    queryFn: () => postSeriesUseCases.listOccurrences().execute(series.id),
  });
  const upcoming = (dates.data ?? []).slice(0, 6);
  const schedule = { weekdays: series.schedule.weekdays, time: series.schedule.startTime };

  const confirm = confirming ? (
    <View style={styles.confirm} testID={`post-series-confirm-${series.id}`}>
      <Text style={styles.question}>
        {confirming.kind === 'end'
          ? t('postSeries.endConfirm')
          : t('postSeries.cancelDateConfirm', { date: dayLabel(confirming.date.startsAt) })}
      </Text>
      <View style={styles.actions}>
        <DangerButton
          testID={`post-series-confirm-yes-${series.id}`}
          size="sm"
          label={t(confirming.kind === 'end' ? 'postSeries.endYes' : 'postSeries.cancelDateYes')}
          loading={busy}
          onPress={() => {
            const action = confirming.kind === 'end'
              ? () => postSeriesUseCases.setStatus().execute(series.id, 'ended')
              : () => postSeriesUseCases.cancelOccurrence().execute(confirming.date.postId);
            void run(action).then(() => setConfirming(null));
          }}
        />
        <GhostButton size="sm" label={t('postSeries.keep')} disabled={busy} onPress={() => setConfirming(null)} />
      </View>
    </View>
  ) : null;

  const buttons = (
    <View style={styles.actions}>
      {actions.pause || actions.resume ? (
        <SecondaryButton
          testID={`post-series-${actions.resume ? 'resume' : 'pause'}-${series.id}`}
          size="sm"
          icon={actions.resume ? 'play-outline' : 'pause-outline'}
          label={t(actions.resume ? 'postSeries.resume' : 'postSeries.pause')}
          disabled={busy}
          onPress={() => void run(() => postSeriesUseCases.setStatus().execute(series.id, actions.resume ? 'active' : 'paused'))}
        />
      ) : null}
      <GhostButton
        testID={`post-series-edit-${series.id}`}
        size="sm"
        icon="time-outline"
        label={t('postSeries.reschedule')}
        disabled={busy}
        onPress={() => setEditing((open) => !open)}
      />
      {actions.end ? (
        <DangerButton
          testID={`post-series-end-${series.id}`}
          size="sm"
          label={t('postSeries.end')}
          disabled={busy}
          onPress={() => setConfirming({ kind: 'end' })}
        />
      ) : null}
    </View>
  );

  return (
    <KcRowCard
      testID={`post-series-row-${series.id}`}
      containerStyle={styles.row}
      tone="give"
      placeholderIcon="repeat-outline"
      title={series.title}
      meta={[rideSeriesLabel(schedule, t), rideSeriesUntilLabel(series.schedule.endsOn, t)]}
      statusLabel={series.status === 'paused' ? t('postSeries.status.paused') : null}
      footer={
        <View style={styles.footer}>
          {confirm ?? buttons}
          {series.status === 'paused' ? <Text style={styles.hint}>{t('postSeries.pauseHint')}</Text> : null}
          {editing ? (
            <PostSeriesScheduleEditor
              series={series}
              busy={busy}
              onSave={(next) =>
                run(() => postSeriesUseCases.update().execute(series.id, { schedule: next }), 'postSeries.saved').then(() => setEditing(false))
              }
              onClose={() => setEditing(false)}
            />
          ) : null}
          <Text style={styles.label}>{t('postSeries.upcoming')}</Text>
          {upcoming.length === 0 && !dates.isLoading ? <Text style={styles.hint}>{t('postSeries.noUpcoming')}</Text> : null}
          {upcoming.map((date) => (
            <View key={date.postId} style={styles.dateRow} testID={`post-series-date-${date.postId}`}>
              <Text style={styles.date}>{dayLabel(date.startsAt)}</Text>
              <GhostButton
                testID={`post-series-cancel-date-${date.postId}`}
                size="sm"
                label={t('postSeries.cancelDate')}
                disabled={busy}
                onPress={() => setConfirming({ kind: 'date', date })}
              />
            </View>
          ))}
        </View>
      }
    />
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  row: { marginHorizontal: spacing.lg },
  footer: { gap: spacing.sm, paddingTop: spacing.sm },
  actions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
  confirm: { gap: spacing.sm },
  question: { ...typography.body, color: colors.textPrimary },
  label: { ...typography.label, color: colors.textSecondary },
  hint: { ...typography.caption, color: colors.textSecondary },
  dateRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: spacing.sm },
  date: { ...typography.body, color: colors.textPrimary, flex: 1 },
}));
