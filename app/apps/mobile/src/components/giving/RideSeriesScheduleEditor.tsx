// Reschedules a recurring ride (FR-RIDE-046): weekdays, departure time and end date. The route and the
// offer are not editable here — a different route is a new series.
import React, { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing } from '@kc/ui';
import { localIsoDate, localTimeHHmm, type RideSeries, type RideSeriesSchedule, type RideWeekday } from '@kc/domain';
import { DateTimeField } from '../ui/DateTimeField';
import { GhostButton, PrimaryButton } from '../ui/Buttons';
import { RideWeekdayPicker } from './RideWeekdayPicker';
import { RideEndDateField } from './RideEndDateField';

interface Props {
  readonly series: RideSeries;
  readonly busy: boolean;
  readonly onSave: (schedule: RideSeriesSchedule, durationMinutes: number | null) => Promise<unknown>;
  readonly onClose: () => void;
}

/** Today at `HH:mm`, for the time picker. */
function timeToDate(time: string): Date {
  const [hours, minutes] = time.split(':').map(Number);
  const d = new Date();
  d.setHours(hours ?? 0, minutes ?? 0, 0, 0);
  return d;
}

/** Midnight of an ISO date, for the day picker; null when open-ended. */
function isoToDate(iso: string | null): Date | null {
  return iso ? new Date(`${iso}T00:00`) : null;
}

export function RideSeriesScheduleEditor({ series, busy, onSave, onClose }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  const [weekdays, setWeekdays] = useState<RideWeekday[]>([...series.schedule.weekdays]);
  const [time, setTime] = useState<Date>(timeToDate(series.schedule.time));
  const [endsOn, setEndsOn] = useState<Date | null>(isoToDate(series.schedule.endsOn));

  return (
    <View style={styles.box} testID={`ride-series-editor-${series.id}`}>
      <RideWeekdayPicker value={weekdays} onChange={setWeekdays} disabled={busy} />
      <DateTimeField
        testID="ride-series-time"
        mode="time"
        label={t('rideSeries.time')}
        value={time}
        disabled={busy}
        onChange={setTime}
      />
      <RideEndDateField value={endsOn} onChange={setEndsOn} disabled={busy} />
      <View style={styles.actions}>
        <PrimaryButton
          testID={`ride-series-save-${series.id}`}
          size="sm"
          label={t('rideSeries.save')}
          loading={busy}
          disabled={weekdays.length === 0}
          onPress={() =>
            void onSave(
              { weekdays, time: localTimeHHmm(time), endsOn: endsOn ? localIsoDate(endsOn) : null },
              series.durationMinutes,
            )
          }
        />
        <GhostButton size="sm" label={t('rideSeries.keep')} disabled={busy} onPress={onClose} />
      </View>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  box: { gap: spacing.sm, padding: spacing.md, borderRadius: spacing.md, backgroundColor: colors.surfaceRaised },
  actions: { flexDirection: 'row' as const, gap: spacing.sm },
}));
