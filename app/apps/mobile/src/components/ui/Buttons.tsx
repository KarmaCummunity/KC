// Shared buttons — the one call-to-action look for every screen (spec 17 §4.1, issue #1286).
//
//   <PrimaryButton label="..." onPress={submit} loading={busy} disabled={!valid} fullWidth />
//   <SecondaryButton label="..." size="md" icon="open-outline" onPress={open} />
//   <GhostButton label="..." size="sm" onPress={edit} />           // compact admin size
//   <DangerButton label="..." onPress={confirmDelete} loading={busy} />
//   <AlertButton label="..." icon="alert-circle-outline" onPress={callForHelp} />
//
// Variants:
//   PrimaryButton   — solid brand orange, inverse text.
//   SecondaryButton — surface card with a light border and the neutral card lift.
//   GhostButton     — text only, brand-coloured, no fill.
//   DangerButton    — solid `error` red, inverse text; only for destructive
//                     actions (delete, block, remove) — D94.
//   AlertButton     — outlined in `error`, `error` label: an alarm (the ride
//                     emergency call), neither a primary nor destructive —
//                     spec 17 §8.1 call 7.
//
// Sizes (`size`, default `lg` so existing callers keep their look):
//   lg 56pt · md 48pt · sm 36pt (compact, admin). Every size keeps a 44pt touch
//   target; `sm` extends its hit area with `hitSlop` instead of growing.
//
// States: `disabled` and `loading` both block presses and fade the button;
// `loading` swaps the label for a spinner without changing the button's size
// and is announced as busy. Press feedback: scale 1 → 0.97 (skipped under
// reduced motion) and a light haptic (opt out with `haptic={false}`).
//
// Icon: an Ionicons glyph (`icon`) or any node (`iconNode`) on the trailing side
// of the label, so in Hebrew it sits on the left like the welcome buttons. On
// `lg` it is pinned to the trailing edge; on `md` / `sm` it follows the label.
import React from 'react';
import { ActivityIndicator, TouchableOpacity, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { hapticLightImpact } from '../../lib/haptics';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Text, type ColorPalette } from '@kc/ui';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { tapTargetHitSlop } from './kitMetrics';
import { BUTTON_HEIGHT, BUTTON_ICON_SIZE, useButtonStyles, type ButtonSize } from './buttonStyles';

export type { ButtonSize } from './buttonStyles';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'alert';

export interface ButtonProps {
  /** Visible text; also the accessible name unless `accessibilityLabel` is set. */
  readonly label: string;
  readonly onPress: () => void;
  /** Height, radius, padding and type scale. Defaults to `lg` (56pt). */
  readonly size?: ButtonSize;
  /** Ionicons glyph on the trailing side of the label. */
  readonly icon?: keyof typeof Ionicons.glyphMap;
  /** Custom trailing node (e.g. a brand logo); wins over `icon`. */
  readonly iconNode?: React.ReactNode;
  /** Shows a spinner, blocks presses and announces the button as busy. */
  readonly loading?: boolean;
  /** Blocks presses and fades the button; announced as disabled. */
  readonly disabled?: boolean;
  /** Light haptic on press. Defaults to true. */
  readonly haptic?: boolean;
  readonly testID?: string;
  readonly accessibilityLabel?: string;
  /** Stretch to the parent's width. */
  readonly fullWidth?: boolean;
}

/** Scale-on-press feedback; a no-op when the OS asks for reduced motion. */
function useButtonPress(reduced: boolean) {
  const scale = useSharedValue(1);
  const onIn = () => {
    scale.value = reduced ? 1 : withTiming(0.97, { duration: 100 });
  };
  const onOut = () => {
    scale.value = reduced ? 1 : withSpring(1, { damping: 15 });
  };
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return { onIn, onOut, style };
}

/**
 * Label, icon and spinner colour for a variant. The solid variants use
 * `textInverse`: white on the light palette's fills, near-black on the dark
 * palette's lighter fills, so both stay AA (spec 17 §5).
 */
function foregroundColor(variant: Variant, colors: ColorPalette): string {
  if (variant === 'primary' || variant === 'danger') return colors.textInverse;
  if (variant === 'alert') return colors.error;
  return variant === 'ghost' ? colors.primary : colors.textPrimary;
}

function Button({
  variant,
  label,
  onPress,
  size = 'lg',
  icon,
  iconNode,
  loading = false,
  disabled = false,
  haptic = true,
  testID,
  accessibilityLabel,
  fullWidth,
}: ButtonProps & { variant: Variant }) {
  const reduced = useReducedMotion();
  const press = useButtonPress(reduced);
  const styles = useButtonStyles();
  const { colors } = useTheme();
  const inactive = loading || disabled;
  const fg = foregroundColor(variant, colors);

  const handlePress = () => {
    if (haptic) hapticLightImpact();
    onPress();
  };

  const containerStyle = [
    styles.base,
    styles[`size_${size}`],
    fullWidth && styles.fullWidth,
    styles[variant],
    inactive && styles.inactive,
  ];
  const textStyle = [
    styles[`text_${size}`],
    (variant === 'primary' || variant === 'danger') && styles.textOnFill,
    variant === 'secondary' && styles.textOnSurface,
    variant === 'ghost' && styles.textOnGhost,
    variant === 'alert' && styles.textOnAlert,
    loading && styles.hidden,
  ];
  const glyph = iconNode ?? (icon ? <Ionicons name={icon} size={BUTTON_ICON_SIZE[size]} color={fg} /> : null);

  return (
    <Animated.View style={[press.style, fullWidth && styles.fullWidth]}>
      <TouchableOpacity
        style={containerStyle}
        onPress={handlePress}
        onPressIn={press.onIn}
        onPressOut={press.onOut}
        activeOpacity={1}
        disabled={inactive}
        hitSlop={tapTargetHitSlop(BUTTON_HEIGHT[size])}
        testID={testID}
        // aria-* props work on native and web alike (RN-Web drops accessibilityState).
        role="button"
        aria-label={accessibilityLabel ?? label}
        aria-disabled={inactive}
        aria-busy={loading}
      >
        <Text style={textStyle}>{label}</Text>
        {/* The lg icon is pinned to the trailing edge; smaller sizes keep it beside the label.
            While loading it stays in the layout (hidden) so the button keeps its width. */}
        {glyph ? <View style={[size === 'lg' && styles.iconSlot, loading && styles.hidden]}>{glyph}</View> : null}
        {loading ? (
          <View style={styles.spinner}>
            <ActivityIndicator color={fg} />
          </View>
        ) : null}
      </TouchableOpacity>
    </Animated.View>
  );
}

/** Solid brand call to action — one per screen (spec 17 §8.1 call 6). */
export function PrimaryButton(props: ButtonProps) {
  return <Button {...props} variant="primary" />;
}

/** Outlined surface button for the second action beside a primary one. */
export function SecondaryButton(props: ButtonProps) {
  return <Button {...props} variant="secondary" />;
}

/** Text-only button for low-emphasis actions (cancel, "view all", inline edits). */
export function GhostButton(props: ButtonProps) {
  return <Button {...props} variant="ghost" />;
}

/**
 * Solid red button for a destructive action (delete, block, remove), usually
 * the confirm action of a dialog. Everything else uses `PrimaryButton`
 * (D94).
 */
export function DangerButton(props: ButtonProps) {
  return <Button {...props} variant="danger" />;
}

/**
 * Outlined red button for an alarm — the ride emergency call. It is neither
 * the screen's primary nor a destructive action, so it takes neither fill:
 * the `error` outline and ink mark it as the one control that calls for help
 * (spec 17 §8.1 call 7).
 */
export function AlertButton(props: ButtonProps) {
  return <Button {...props} variant="alert" />;
}
