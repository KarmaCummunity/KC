// FR-AUTH-010 AC2.d — date of birth as three numeric fields (day, month, year).
// A native date picker makes a year like 1985 a long scroll; typing it is faster on every
// platform and reads the same on web. The field reports an ISO `YYYY-MM-DD` only when the three
// parts form a real calendar date, and shows the 18+ rule inline before anything is sent.
import React, { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { composeIsoDate, dateOfBirthIssue, parseIsoDate } from '@kc/domain';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { TextField } from './ui/TextField';

interface Props {
  /** ISO `YYYY-MM-DD`, or null while the three parts do not form a valid date. */
  readonly value: string | null;
  readonly onChange: (iso: string | null) => void;
  readonly disabled?: boolean;
}

const digitsOnly = (text: string) => text.replaceAll(/\D/g, '');

export function DateOfBirthField({ value, onChange, disabled }: Props) {
  const styles = useStyles();
  const { t } = useTranslation();
  // The text the member typed. It is kept apart from `value`, which is null until the date is real.
  const initial = value ? parseIsoDate(value) : null;
  const [day, setDay] = useState(initial ? String(initial[2]) : '');
  const [month, setMonth] = useState(initial ? String(initial[1]) : '');
  const [year, setYear] = useState(initial ? String(initial[0]) : '');

  const report = (d: string, m: string, y: string) => {
    const complete = d.length > 0 && m.length > 0 && y.length === 4;
    onChange(complete ? composeIsoDate(Number(d), Number(m), Number(y)) : null);
  };

  const filled = day.length > 0 && month.length > 0 && year.length === 4;
  const issue = !filled ? null : value ? dateOfBirthIssue(value, new Date()) : 'invalid_date_of_birth';
  const errorText = issue ? t(issue === 'underage' ? 'dateOfBirth.errors.underage' : 'dateOfBirth.errors.invalid') : null;

  const part = (label: string, text: string, max: number, set: (v: string) => void, next: (v: string) => void) => (
    <TextField
      label={label}
      value={text}
      onChangeText={(raw) => {
        const clean = digitsOnly(raw).slice(0, max);
        set(clean);
        next(clean);
      }}
      keyboardType="number-pad"
      maxLength={max}
      editable={!disabled}
      containerStyle={styles.part}
    />
  );

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{t('dateOfBirth.label')}</Text>
      <View style={styles.row}>
        {part(t('dateOfBirth.day'), day, 2, setDay, (v) => report(v, month, year))}
        {part(t('dateOfBirth.month'), month, 2, setMonth, (v) => report(day, v, year))}
        {part(t('dateOfBirth.year'), year, 4, setYear, (v) => report(day, month, v))}
      </View>
      <Text style={errorText ? styles.error : styles.helper}>{errorText ?? t('dateOfBirth.helper')}</Text>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  wrapper: { gap: spacing.xs },
  label: { ...typography.label, color: colors.textSecondary },
  row: { flexDirection: 'row', gap: spacing.sm },
  part: { flex: 1 },
  helper: { ...typography.bodySmall, color: colors.textSecondary },
  error: { ...typography.bodySmall, color: colors.error },
}));
