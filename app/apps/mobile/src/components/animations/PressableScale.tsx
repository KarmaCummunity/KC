import React from 'react';
import { Pressable, StyleSheet, ViewStyle, StyleProp, AccessibilityProps } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { hapticLightImpact } from '../../lib/haptics';
import { MOTION } from '../../lib/animations/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';

/** Props that size / place the pressable in its *parent*; must stay on `Pressable`. */
const OUTER_LAYOUT_KEYS = new Set<string>([
  'flex',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'margin',
  'marginTop',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'marginHorizontal',
  'marginVertical',
  'marginStart',
  'marginEnd',
  'alignSelf',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'zIndex',
  'aspectRatio',
]);

function splitPressableStyle(style: StyleProp<ViewStyle> | undefined): {
  outer: ViewStyle;
  inner: ViewStyle;
} {
  if (style == null) return { outer: {}, inner: {} };
  const flat = StyleSheet.flatten(style) as Record<string, unknown>;
  const outer: ViewStyle = {};
  const inner: ViewStyle = {};
  for (const key of Object.keys(flat)) {
    const v = flat[key];
    if (v === undefined) continue;
    if (OUTER_LAYOUT_KEYS.has(key)) {
      (outer as Record<string, unknown>)[key] = v;
    } else {
      (inner as Record<string, unknown>)[key] = v;
    }
  }
  return { outer, inner };
}

function outerExpandsInParent(outer: ViewStyle): boolean {
  const f = outer.flex;
  if (typeof f === 'number' && f > 0) return true;
  const g = outer.flexGrow;
  if (typeof g === 'number' && g > 0) return true;
  return false;
}

export interface PressableScaleProps extends AccessibilityProps {
  readonly children: React.ReactNode;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly haptic?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly hitSlop?: number;
}

export function PressableScale({
  children,
  onPress,
  disabled = false,
  haptic = true,
  style,
  hitSlop,
  ...a11y
}: PressableScaleProps) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);

  const handlePressIn = () => {
    scale.value = reduced ? 1 : withSpring(MOTION.pressScale, MOTION.spring);
  };
  const handlePressOut = () => {
    scale.value = reduced ? 1 : withSpring(1, MOTION.spring);
  };
  const handlePress = () => {
    if (haptic) hapticLightImpact();
    onPress();
  };

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const { outer, inner: innerVisual } = splitPressableStyle(style);
  const innerLayout: ViewStyle = { width: '100%' };
  if (typeof outer.height === 'number' || typeof outer.minHeight === 'number') {
    innerLayout.height = '100%';
  }
  if (outerExpandsInParent(outer)) {
    innerLayout.flex = 1;
    innerLayout.minHeight = 0;
    innerLayout.alignSelf = 'stretch';
  }

  // Outer keeps flex/width/margin so parents (e.g. donations grid) size the hit
  // target. Inner applies flexDirection/justifyContent/gap so row CTAs lay out
  // children correctly — RN-Web + RTL otherwise stacks them in a column inside
  // the scaled wrapper.
  return (
    <Pressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      hitSlop={hitSlop}
      style={outer}
      {...a11y}
    >
      <Animated.View style={[innerLayout, innerVisual, animated]}>{children}</Animated.View>
    </Pressable>
  );
}
