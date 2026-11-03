// Skeleton placeholder block — a gentle opacity pulse over the `skeleton`
// surface token. Built on RN's Animated primitive only (no reanimated dep) so
// it stays inside the design-system package's dependency budget and works on
// web (RN-Web) and native alike.
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

export interface SkeletonProps {
  /** Defaults to filling the parent's width. */
  width?: ViewStyle['width'];
  height?: ViewStyle['height'];
  /** Corner radius. Pass a large value for circular avatars. */
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

const PULSE_MIN = 0.45;
const PULSE_MAX = 1;
const PULSE_MS = 750;

export function Skeleton({ width = '100%', height = 14, radius = 6, style }: SkeletonProps) {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(PULSE_MIN)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0.7);
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: PULSE_MAX, duration: PULSE_MS, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: PULSE_MIN, duration: PULSE_MS, useNativeDriver: false }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [pulse, reduceMotion]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { width, height, borderRadius: radius, backgroundColor: colors.skeleton, opacity: pulse },
        style,
      ]}
    />
  );
}
