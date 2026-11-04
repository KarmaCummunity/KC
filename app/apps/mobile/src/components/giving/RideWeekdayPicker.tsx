// The weekdays of a recurring ride (FR-RIDE-046): seven chips, Sunday first, any number picked.
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { RIDE_WEEKDAYS, type RideWeekday } from '@kc/domain';
import { SearchChip } from '../search/SearchChip';

interface Props {
  readonly value: readonly RideWeekday[];
  readonly onChange: (next: RideWeekday[]) => void;
  readonly disabled?: boolean;
}

export function RideWeekdayPicker({ value, onChange, disabled }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  const toggle = (day: RideWeekday) => {
    if (disabled) return;
    onChange(value.includes(day) ? value.filter((d) => d !== day) : [...value, day].sort((a, b) => a - b));
  };
  return (
    <View style={styles.block}>
      <Text style={styles.label}>{t('rideSeries.daysLabel')}</Text>
      <View style={styles.chips} testID="ride-weekday-picker">
        {RIDE_WEEKDAYS.map((day) => (
          <SearchChip key={day} label={t(`rideRoutes.weekday.${day}`)} active={value.includes(day)} onPress={() => toggle(day)} />
        ))}
      </View>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  block: { gap: spacing.xs },
  label: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  chips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
}));
