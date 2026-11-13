// The weekdays of a recurring ride (FR-RIDE-046): seven chips, Sunday first, any number picked.
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { RIDE_WEEKDAYS, type RideWeekday } from '@kc/domain';
import { FilterChipRow } from '../filterKit/FilterChipRow';

interface Props {
  readonly value: readonly RideWeekday[];
  readonly onChange: (next: RideWeekday[]) => void;
  readonly disabled?: boolean;
}

export function RideWeekdayPicker({ value, onChange, disabled }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  return (
    <View style={styles.block}>
      <Text style={styles.label}>{t('rideSeries.daysLabel')}</Text>
      <FilterChipRow<RideWeekday>
        multiSelect
        testID="ride-weekday-picker"
        testIDPrefix="ride-weekday"
        chipSize="md"
        options={RIDE_WEEKDAYS.map((day) => ({ value: day, label: t(`rideRoutes.weekday.${day}`) }))}
        value={value}
        onChange={(next) => !disabled && onChange([...next].sort((a, b) => a - b))}
      />
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  block: { gap: spacing.xs },
  label: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
}));
