// "Recurring ride" in the create form (docs/spec/05_giving_worlds.md §5.3 step 1, FR-RIDE-046;
// FR-RIDE-046): a switch, then the weekdays and an optional end date. The departure field above
// gives the time of day; the server publishes one ride per picked day for the coming month.
import React from 'react';
import { Switch, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, useTheme, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { localTimeHHmm, type RideWeekday } from '@kc/domain';
import { RideWeekdayPicker } from './RideWeekdayPicker';
import { RideEndDateField } from './RideEndDateField';

/** What the member picked for a recurring ride; the time comes from the departure field. */
export interface RideRecurrenceDraft {
  readonly weekdays: readonly RideWeekday[];
  readonly endsOn: Date | null;
}

/** A fresh draft when the switch turns on: the departure's weekday, open-ended. */
export function initialRecurrenceDraft(departsAt: Date | null): RideRecurrenceDraft {
  return { weekdays: departsAt ? [departsAt.getDay() as RideWeekday] : [], endsOn: null };
}

interface Props {
  /** Null while the ride is a single one. */
  readonly value: RideRecurrenceDraft | null;
  readonly onChange: (next: RideRecurrenceDraft | null) => void;
  /** The departure picked above; its time of day is the series time. */
  readonly departsAt: Date | null;
  readonly disabled?: boolean;
  /** Another recurring post (an event, FR-POST-024) names its own switch and hint. */
  readonly toggleLabel?: string;
  readonly hint?: string;
  readonly testID?: string;
}

export function RideRecurrenceFields({ value, onChange, departsAt, disabled, toggleLabel, hint, testID = 'ride-recurrence' }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();

  return (
    <View style={styles.block} testID={testID}>
      <View style={styles.switchRow}>
        <Text style={styles.label}>{toggleLabel ?? t('rideSeries.toggle')}</Text>
        <Switch
          testID={`${testID}-switch`}
          accessibilityLabel={toggleLabel ?? t('rideSeries.toggle')}
          value={value !== null}
          disabled={disabled}
          onValueChange={(on) => onChange(on ? initialRecurrenceDraft(departsAt) : null)}
          trackColor={{ true: colors.primary }}
        />
      </View>
      {value ? (
        <>
          <RideWeekdayPicker value={value.weekdays} onChange={(weekdays) => onChange({ ...value, weekdays })} disabled={disabled} />
          <RideEndDateField value={value.endsOn} onChange={(endsOn) => onChange({ ...value, endsOn })} disabled={disabled} />
          <Text style={styles.hint}>
            {hint ?? (departsAt ? t('rideSeries.publishHint', { time: localTimeHHmm(departsAt) }) : t('rideSeries.departureHint'))}
          </Text>
        </>
      ) : null}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  block: { gap: spacing.sm },
  switchRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: spacing.md },
  label: { ...typography.body, color: colors.textPrimary, flex: 1, textAlign: rtlTextAlignStart },
  hint: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
}));
