import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, typography, spacing, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

const useStyles = makeUseStyles(({ colors }) => ({
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'flex-end' as const,
    gap: spacing.xs,
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
  },
  required: {
    ...typography.label,
    color: colors.error,
    fontSize: typography.body.fontSize,
    lineHeight: 18,
  },
}));

interface Props {
  readonly label: string;
  readonly required?: boolean;
}

/** Section label with optional red asterisk for required fields (matches create-post form). */
export function FormFieldLabel({ label, required = false }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  return (
    <View style={styles.row} accessibilityRole="text">
      <Text style={styles.label}>{label}</Text>
      {required ? (
        <Text style={styles.required} accessibilityLabel={t('common.requiredFieldA11y')}>
          *
        </Text>
      ) : null}
    </View>
  );
}
