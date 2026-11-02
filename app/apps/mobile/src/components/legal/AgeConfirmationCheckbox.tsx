import { View, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { typography, spacing, useTheme, Text } from '@kc/ui';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

interface AgeConfirmationCheckboxProps {
  readonly checked: boolean;
  readonly onToggle: (v: boolean) => void;
}

/** Required 18+ confirmation shown on the sign-up consent screen (#1450). */
export function AgeConfirmationCheckbox({ checked, onToggle }: AgeConfirmationCheckboxProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={t('legal.checkboxAge18')}
      onPress={() => onToggle(!checked)}
      style={{
        flexDirection: rowDirectionStart,
        alignItems: 'center',
        gap: spacing.sm,
        backgroundColor: colors.surfaceRaised,
        borderRadius: 12,
        padding: spacing.md,
        marginBottom: spacing.md,
      }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 4,
          borderWidth: 2,
          borderColor: colors.primary,
          backgroundColor: checked ? colors.primary : 'transparent',
        }}
      />
      <Text
        style={{
          ...typography.body,
          color: colors.textPrimary,
          flex: 1,
          textAlign: rtlTextAlignStart,
          writingDirection: 'rtl',
        }}
      >
        {t('legal.checkboxAge18')}
      </Text>
    </Pressable>
  );
}
