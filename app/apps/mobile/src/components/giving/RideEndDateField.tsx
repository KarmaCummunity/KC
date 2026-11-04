// The optional end date of a recurring ride (FR-RIDE-046): a day picker, with "no end date" to clear it.
import React from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { DateTimeField } from '../ui/DateTimeField';

interface Props {
  readonly value: Date | null;
  readonly onChange: (next: Date | null) => void;
  readonly disabled?: boolean;
}

export function RideEndDateField({ value, onChange, disabled }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  return (
    <View style={styles.block}>
      <DateTimeField
        testID="ride-series-ends-on"
        mode="date"
        label={t('rideSeries.endsOn')}
        placeholder={t('rideSeries.noEnd')}
        value={value}
        minimumDate={new Date()}
        disabled={disabled}
        onChange={onChange}
      />
      {value ? (
        <Pressable accessibilityRole="button" testID="ride-series-ends-on-clear" disabled={disabled} onPress={() => onChange(null)}>
          <Text style={styles.link}>{t('rideSeries.clearEnd')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  block: { gap: spacing.xs },
  link: { ...typography.caption, color: colors.primary, paddingVertical: spacing.xs, textAlign: rtlTextAlignStart },
}));
