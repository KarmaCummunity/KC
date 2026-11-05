// A labelled on/off row of the ride create form, with an optional hint under it: the one-tap
// shortcuts "from my current location" and "leave now" (#1411).
import React from 'react';
import { Switch, View } from 'react-native';
import { makeUseStyles, spacing, typography, useTheme, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

interface Props {
  readonly testID: string;
  readonly label: string;
  readonly value: boolean;
  readonly onValueChange: (on: boolean) => void;
  readonly hint?: string | null;
  readonly disabled?: boolean;
}

export function RideOptionSwitch({ testID, label, value, onValueChange, hint, disabled }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.block}>
      <View style={styles.row}>
        <Text style={styles.label}>{label}</Text>
        <Switch
          testID={testID}
          accessibilityLabel={label}
          value={value}
          disabled={disabled}
          onValueChange={onValueChange}
          trackColor={{ true: colors.primary }}
        />
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  block: { gap: spacing.xs },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: spacing.md },
  label: { ...typography.body, color: colors.textPrimary, flex: 1, textAlign: rtlTextAlignStart },
  hint: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
}));
