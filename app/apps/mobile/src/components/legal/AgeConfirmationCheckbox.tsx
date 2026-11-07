import { View, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { typography, spacing, radius, useTheme, Text } from '@kc/ui';
import { layoutWritingDirectionStyle, rowDirectionStart } from '../../lib/rtlLayout';
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
      testID="legal-consent-age-checkbox"
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={t('legal.checkboxAge18')}
      onPress={() => onToggle(!checked)}
      style={{
        flexDirection: rowDirectionStart,
        alignItems: 'center',
        gap: spacing.sm,
        backgroundColor: colors.surfaceRaised,
        borderRadius: radius.md,
        padding: spacing.md,
        marginBottom: spacing.md,
      }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: radius.xs,
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
          ...layoutWritingDirectionStyle(),
        }}
      >
        {t('legal.checkboxAge18')}
      </Text>
    </Pressable>
  );
}
