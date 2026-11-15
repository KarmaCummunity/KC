// Changes the times of a recurring event (FR-POST-024 AC5): weekdays, start time and end date.
// The length of a date stays as it is. Upcoming dates nobody registered for follow the new
// schedule; a date with registrations keeps its time.
import React, { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing } from '@kc/ui';
import { localIsoDate, localTimeHHmm, type PostSeries, type PostSeriesSchedule, type PostSeriesWeekday } from '@kc/domain';
import { DateTimeField } from '../ui/DateTimeField';
import { GhostButton, PrimaryButton } from '../ui/Buttons';
import { RideWeekdayPicker } from '../giving/RideWeekdayPicker';
import { RideEndDateField } from '../giving/RideEndDateField';

interface Props {
  readonly series: PostSeries;
  readonly busy: boolean;
  readonly onSave: (schedule: PostSeriesSchedule) => Promise<unknown>;
  readonly onClose: () => void;
}

/** Today at `HH:mm`, for the time picker. */
function timeToDate(time: string): Date {
  const [hours, minutes] = time.split(':').map(Number);
  const date = new Date();
  date.setHours(hours ?? 0, minutes ?? 0, 0, 0);
  return date;
}

export function PostSeriesScheduleEditor({ series, busy, onSave, onClose }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  const [weekdays, setWeekdays] = useState<PostSeriesWeekday[]>([...series.schedule.weekdays]);
  const [time, setTime] = useState<Date>(timeToDate(series.schedule.startTime));
  // Midnight of the ISO end date for the day picker; null when the series is open-ended.
  const [endsOn, setEndsOn] = useState<Date | null>(series.schedule.endsOn ? new Date(`${series.schedule.endsOn}T00:00`) : null);

  return (
    <View style={styles.box} testID={`post-series-editor-${series.id}`}>
      <RideWeekdayPicker value={weekdays} onChange={setWeekdays} disabled={busy} />
      <DateTimeField testID="post-series-time" mode="time" label={t('postSeries.startTime')} value={time} disabled={busy} onChange={setTime} />
      <RideEndDateField value={endsOn} onChange={setEndsOn} disabled={busy} />
      <View style={styles.actions}>
        <PrimaryButton
          testID={`post-series-save-${series.id}`}
          size="sm"
          label={t('postSeries.save')}
          loading={busy}
          disabled={weekdays.length === 0}
          onPress={() =>
            void onSave({
              weekdays,
              startTime: localTimeHHmm(time),
              durationMinutes: series.schedule.durationMinutes,
              endsOn: endsOn ? localIsoDate(endsOn) : null,
            })
          }
        />
        <GhostButton size="sm" label={t('postSeries.keep')} disabled={busy} onPress={onClose} />
      </View>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  box: { gap: spacing.sm, padding: spacing.md, borderRadius: spacing.md, backgroundColor: colors.surfaceRaised },
  actions: { flexDirection: 'row' as const, gap: spacing.sm },
}));
