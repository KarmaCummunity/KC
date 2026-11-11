// Short fade used by content screens. Delays live in ENTRY_DELAY (all 0) so a
// screen is not held blank after its navigation transition. Welcome and auth
// keep their own, slower entrances.
//
// The component honors prefers-reduced-motion (renders the final state with no
// transform).
import React, { useEffect } from 'react';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { type StyleProp, type ViewStyle } from 'react-native';
import { MOTION } from '../../lib/animations/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';

export { ENTRY_DELAY } from '../../lib/animations/motion';

type Variant = 'hero' | 'side' | 'bottom';

interface MotionEntryProps {
  readonly children: React.ReactNode;
  readonly variant?: Variant;
  readonly delay?: number;
  readonly style?: StyleProp<ViewStyle>;
}

const CONFIG = {
  hero: {
    translateY: MOTION.entryDistance,
    translateX: 0,
    spring: MOTION.spring,
    duration: MOTION.duration.base,
  },
  side: {
    translateY: 0,
    translateX: MOTION.entryDistance,
    spring: MOTION.spring,
    duration: MOTION.duration.fast,
  },
  bottom: {
    translateY: MOTION.entryDistance,
    translateX: 0,
    spring: MOTION.spring,
    duration: MOTION.duration.fast,
  },
} as const;

export function MotionEntry({
  children,
  variant = 'bottom',
  delay = 0,
  style,
}: MotionEntryProps) {
  const reduced = useReducedMotion();
  const cfg = CONFIG[variant];
  const opacity = useSharedValue(reduced ? 1 : 0);
  const ty = useSharedValue(reduced ? 0 : cfg.translateY);
  const tx = useSharedValue(reduced ? 0 : cfg.translateX);

  useEffect(() => {
    if (reduced) {
      opacity.value = 1;
      ty.value = 0;
      tx.value = 0;
      return;
    }
    opacity.value = withDelay(delay, withTiming(1, { duration: cfg.duration }));
    ty.value = withDelay(delay, withSpring(0, cfg.spring));
    tx.value = withDelay(delay, withSpring(0, cfg.spring));
  }, [reduced, delay, cfg.duration, cfg.spring, opacity, ty, tx]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: ty.value }, { translateX: tx.value }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
