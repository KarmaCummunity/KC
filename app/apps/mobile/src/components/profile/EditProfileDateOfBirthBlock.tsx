// FR-VERIFY-012 / FR-AUTH-010 — date of birth on Edit profile (required for verification level 1).
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { DateOfBirthField } from '../DateOfBirthField';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

type Props = {
  readonly value: string | null;
  readonly onChange: (iso: string | null) => void;
  readonly disabled?: boolean;
};

export function EditProfileDateOfBirthBlock({ value, onChange, disabled }: Props) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <View style={styles.field} testID="edit-profile-dob">
      <Text style={styles.label}>{t('dateOfBirth.label')}</Text>
      <Text style={styles.helper}>{t('dateOfBirth.helper')}</Text>
      <DateOfBirthField value={value} onChange={onChange} disabled={disabled} />
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  field: { gap: spacing.xs, marginBottom: spacing.md },
  label: { ...typography.bodySmall, ...typography.bold, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  helper: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart, marginBottom: spacing.xs },
}));
