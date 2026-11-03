// Shared row for settings list — use `View` when there is no `onPress` so nested
// controls (e.g. `Switch`) receive touches; `TouchableOpacity` would steal them.
import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { makeUseStyles, typography, spacing, useTheme, Text, iconSize } from '@kc/ui';
import { rtlTextAlignStart } from '../lib/rtlTextAlignStart';
import { webTextRtl, webViewRtl } from '../lib/webRtlStyle';
import { MirroredIcon } from './ui/MirroredIcon';

export interface SettingsScreenRowProps {
  readonly label: string;
  readonly icon: string;
  readonly onPress?: () => void;
  readonly rightElement?: React.ReactNode;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  /** Stable E2E selector (KC#1235). */
  readonly testID?: string;
}

export function SettingsScreenRow({
  label,
  icon,
  onPress,
  rightElement,
  destructive,
  disabled,
  testID,
}: SettingsScreenRowProps) {
  const styles = useRowStyles();
  const { colors } = useTheme();
  const iconColor = destructive ? colors.error : colors.textSecondary;
  const labelStyle = [styles.rowLabel, destructive && { color: colors.error }];
  const trailing = rightElement ?? (
    <MirroredIcon name="chevron-forward" size={iconSize.md} color={colors.textDisabled} />
  );

  const inner = (
    <>
      <Ionicons name={icon as never} size={iconSize.lg} style={styles.rowIcon} color={iconColor} />
      <Text style={labelStyle}>{label}</Text>
      {trailing}
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        testID={testID}
        style={styles.row}
        onPress={onPress}
        disabled={disabled}
        activeOpacity={0.7}
      >
        {inner}
      </TouchableOpacity>
    );
  }

  return <View testID={testID} style={styles.row}>{inner}</View>;
}

const useRowStyles = makeUseStyles(({ colors }) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
    ...webViewRtl,
  },
  rowIcon: { width: 24 },
  rowLabel: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
}));
