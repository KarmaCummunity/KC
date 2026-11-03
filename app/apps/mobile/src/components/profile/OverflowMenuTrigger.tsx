// ⋮ button that opens a profile overflow menu (own profile and other profiles).
import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { iconSize, spacing, useTheme } from '@kc/ui';

interface Props {
  readonly onPress: () => void;
  /** Screen-reader name of the button. */
  readonly accessibilityLabel: string;
}

/** Vertical-ellipsis icon button; the hit slop grows it to a full touch target. */
export function OverflowMenuTrigger({ onPress, accessibilityLabel }: Props) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={spacing.sm}
      style={styles.trigger}
    >
      <Ionicons name="ellipsis-vertical" size={iconSize.xl} color={colors.textPrimary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trigger: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
});
