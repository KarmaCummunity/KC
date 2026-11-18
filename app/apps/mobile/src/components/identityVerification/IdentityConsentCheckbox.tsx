// FR-VERIFY-004 AC2 — the separate, unticked biometric-processing consent.
import { Pressable, View } from 'react-native';
import { radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { layoutWritingDirectionStyle, rowDirectionStart } from '../../lib/rtlLayout';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

interface IdentityConsentCheckboxProps {
  readonly checked: boolean;
  readonly label: string;
  readonly onToggle: (checked: boolean) => void;
}

export function IdentityConsentCheckbox({ checked, label, onToggle }: IdentityConsentCheckboxProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID="identity-consent-checkbox"
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={() => onToggle(!checked)}
      style={{
        flexDirection: rowDirectionStart,
        alignItems: 'center',
        gap: spacing.sm,
        backgroundColor: colors.surfaceRaised,
        borderRadius: radius.md,
        padding: spacing.md,
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
        {label}
      </Text>
    </Pressable>
  );
}
