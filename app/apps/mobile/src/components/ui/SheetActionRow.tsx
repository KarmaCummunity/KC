// Shared action row for bottom-sheet menus (spec 17 §4.1, issue #1284).
//
//   <SheetActionRow label="Share" icon="share-outline" onPress={share} />
//   <SheetActionRow label="Block user" destructive onPress={block} />
//
// Use it inside `ActionMenuSheet`, or inside a `BottomSheet` with its own layout.
// A row is a full-width button: the label on the reading-start side and an
// optional Ionicons glyph on the end side. `destructive` tints label and glyph
// with `error` (delete, block, ban, remove); the destructive *confirm* that
// follows still uses `DangerButton` (D94). Rows keep a 48pt height, above the
// 44pt touch-target floor.
import React, { type ComponentProps } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { iconSize, spacing, typography, useTheme, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { webTextRtl } from '../../lib/webRtlStyle';
import { BUTTON_HEIGHT } from './buttonStyles';
import { DISABLED_OPACITY } from './kitMetrics';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export interface SheetActionRowProps {
  /** Visible text; also the row's accessible name. */
  readonly label: string;
  readonly onPress: () => void;
  /** Ionicons glyph on the end side of the row. */
  readonly icon?: IoniconName;
  /** Tints the row with `error` for a destructive action. */
  readonly destructive?: boolean;
  /** Fades the row and blocks presses (e.g. while the action is busy). */
  readonly disabled?: boolean;
  readonly testID?: string;
}

/** One pressable action in a bottom-sheet menu. */
export function SheetActionRow({ label, onPress, icon, destructive, disabled, testID }: SheetActionRowProps) {
  const { colors } = useTheme();
  const tint = destructive ? colors.error : colors.textPrimary;
  return (
    <Pressable
      style={[styles.row, disabled && styles.rowDisabled]}
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      // aria-* props work on native and web alike (RN-Web drops accessibilityState).
      role="button"
      aria-label={label}
      aria-disabled={Boolean(disabled)}
    >
      <Text style={[styles.label, { color: tint }]}>{label}</Text>
      {icon ? <Ionicons name={icon} size={iconSize.xl} color={tint} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    // No side padding: the sheet surface already holds the gutter.
    paddingVertical: spacing.md,
    gap: spacing.sm,
    minHeight: BUTTON_HEIGHT.md,
  },
  rowDisabled: { opacity: DISABLED_OPACITY },
  label: {
    ...typography.body,
    textAlign: rtlTextAlignStart,
    flex: 1,
    ...webTextRtl,
  },
});
