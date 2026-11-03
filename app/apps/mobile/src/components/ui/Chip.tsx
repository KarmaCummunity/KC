// Shared chip — the one look for filters, status tags and applied values (spec 17 §4.1, issue #1285).
//
//   <Chip label="Furniture" selected={on} onPress={toggle} />                      // filter (default)
//   <Chip variant="tag" tone="success" label="Done" size="sm" />                   // status tag
//   <Chip variant="removable" label="Haifa" onRemove={clear}
//         removeAccessibilityLabel={t('...', { label: 'Haifa' })} />               // applied value
//
// Variants:
//   filter    — a toggle: outlined surface when off, solid brand orange when
//               `selected`; announced as a checkbox with its checked state.
//   tag       — a non-interactive status label tinted by `tone`; squarer corners
//               so it never reads as something to press.
//   removable — an applied value with a trailing ✕; the whole chip removes it.
//
// Sizes: `md` (36pt) and the compact `sm` (28pt). Interactive chips keep a 44pt
// touch target: at least 44pt wide, and `hitSlop` makes up the height.
// `disabled` fades an interactive chip and blocks presses.
import React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, useTheme } from '@kc/ui';
import { tapTargetHitSlop } from './kitMetrics';
import { CHIP_HEIGHT, CHIP_ICON_SIZE, toneColors, useChipStyles, type ChipSize, type ChipTone } from './chipStyles';

export type { ChipSize, ChipTone } from './chipStyles';

interface ChipBaseProps {
  /** Visible text, kept to one line. */
  readonly label: string;
  /** `md` (default) or the compact `sm`. */
  readonly size?: ChipSize;
  /** Ionicons glyph before the label (on the reading-start side). */
  readonly icon?: keyof typeof Ionicons.glyphMap;
  /** Outer style for layout only (margins, flex); colours and shape stay the kit's. */
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

/** Selectable filter chip (the default variant). */
export interface FilterChipProps extends ChipBaseProps {
  readonly variant?: 'filter';
  readonly selected?: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
  /** Screen-reader name when it should differ from `label`. */
  readonly accessibilityLabel?: string;
}

/** Non-interactive status tag. */
export interface TagChipProps extends ChipBaseProps {
  readonly variant: 'tag';
  /** Tint that carries the status meaning. Defaults to `neutral`. */
  readonly tone?: ChipTone;
}

/** Applied value the user can remove. */
export interface RemovableChipProps extends ChipBaseProps {
  readonly variant: 'removable';
  readonly disabled?: boolean;
  readonly onRemove: () => void;
  /** Localized screen-reader name for the remove action, e.g. "Remove Haifa". */
  readonly removeAccessibilityLabel: string;
}

export type ChipProps = FilterChipProps | TagChipProps | RemovableChipProps;

/**
 * Props a variant renderer receives. `variant` is only the discriminant `Chip`
 * switches on, so the renderers never see it.
 */
type VariantProps<P extends ChipProps> = Omit<P, 'variant'>;

/**
 * Chip in the brand style. The `variant` decides the role: a toggle (`filter`),
 * a read-only status (`tag`) or an applied value with a remove action (`removable`).
 */
export function Chip(props: ChipProps) {
  if (props.variant === 'tag') return <TagChip {...props} />;
  if (props.variant === 'removable') return <RemovableChip {...props} />;
  return <FilterChip {...props} />;
}

/** Props of the chip body shared by every variant. */
interface ChipContentProps {
  readonly label: string;
  /** Optional leading glyph; `undefined` renders the label alone. */
  readonly icon: ChipBaseProps['icon'];
  readonly size: ChipSize;
  /** Foreground colour for both the glyph and the label. */
  readonly color: string;
}

/** Leading icon + one-line label, shared by every variant. */
function ChipContent({ label, icon, size, color }: ChipContentProps) {
  const styles = useChipStyles();
  return (
    <>
      {icon ? <Ionicons name={icon} size={CHIP_ICON_SIZE[size]} color={color} /> : null}
      <Text style={[styles[`text_${size}`], { color }]} numberOfLines={1}>
        {label}
      </Text>
    </>
  );
}

function FilterChip({ label, size = 'md', icon, style, testID, selected = false, disabled = false, onPress, accessibilityLabel }: VariantProps<FilterChipProps>) {
  const styles = useChipStyles();
  const { colors } = useTheme();
  const foreground = selected ? colors.textInverse : colors.textPrimary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={tapTargetHitSlop(CHIP_HEIGHT[size])}
      testID={testID}
      // A filter is a toggle, so it is announced with its checked state; aria-* works on native and web.
      role="checkbox"
      aria-checked={selected}
      aria-disabled={disabled}
      aria-label={accessibilityLabel ?? label}
      style={({ pressed }) => [
        styles.base,
        styles[`size_${size}`],
        styles.interactive,
        selected ? styles.filterSelected : styles.filter,
        pressed && (selected ? styles.pressedSelected : styles.pressedFilter),
        disabled && styles.disabled,
        style,
      ]}
    >
      <ChipContent label={label} icon={icon} size={size} color={foreground} />
    </Pressable>
  );
}

function TagChip({ label, size = 'md', icon, style, testID, tone = 'neutral' }: VariantProps<TagChipProps>) {
  const styles = useChipStyles();
  const { colors } = useTheme();
  const { background, border, foreground } = toneColors(tone, colors);
  return (
    <View
      testID={testID}
      style={[styles.base, styles[`size_${size}`], styles.tag, { backgroundColor: background, borderColor: border }, style]}
    >
      <ChipContent label={label} icon={icon} size={size} color={foreground} />
    </View>
  );
}

function RemovableChip({ label, size = 'md', icon, style, testID, disabled = false, onRemove, removeAccessibilityLabel }: VariantProps<RemovableChipProps>) {
  const styles = useChipStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onRemove}
      disabled={disabled}
      hitSlop={tapTargetHitSlop(CHIP_HEIGHT[size])}
      testID={testID}
      // The whole chip is the remove action; its name says what pressing it does.
      role="button"
      aria-label={removeAccessibilityLabel}
      aria-disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        styles[`size_${size}`],
        styles.interactive,
        styles.removable,
        pressed && styles.pressedRemovable,
        disabled && styles.disabled,
        style,
      ]}
    >
      <ChipContent label={label} icon={icon} size={size} color={colors.primary} />
      <Ionicons name="close-circle" size={CHIP_ICON_SIZE[size]} color={colors.primary} />
    </Pressable>
  );
}
