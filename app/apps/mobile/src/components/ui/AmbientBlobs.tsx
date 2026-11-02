// Decorative ambient background blobs.
// Three offset orange disks that pulse slowly (paused under reduced motion).
// Shared by the welcome / sign-in / sign-up screens and any "main" screen.
//
// `density` controls how prominent the blobs are:
//   - 'auth'    — the original auth-screen intensity (opacity 0.05–0.07).
//   - 'content' — about half that, for content-heavy screens (feed, profile…)
//                 where the blobs should feel like a watermark, not a feature.
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { radius, useTheme } from '@kc/ui';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useReducedMotion } from '../../hooks/useReducedMotion';

interface AmbientBlobsProps {
  readonly density?: 'auth' | 'content';
}

const OPACITY_BY_DENSITY = {
  auth: { a: 0.07, b: 0.05, c: 0.06 },
  content: { a: 0.035, b: 0.025, c: 0.03 },
} as const;

export function AmbientBlobs({ density = 'auth' }: AmbientBlobsProps) {
  // Decoration-only brand orange (spec 17 §4) — the same token in both palettes.
  const { colors } = useTheme();
  const fill = { backgroundColor: colors.primaryVivid };
  const reduced = useReducedMotion();
  const scale1 = useSharedValue(1);
  const scale2 = useSharedValue(1);
  const scale3 = useSharedValue(1);

  useEffect(() => {
    if (reduced) {
      scale1.value = 1;
      scale2.value = 1;
      scale3.value = 1;
      return;
    }
    scale1.value = withRepeat(
      withSequence(withTiming(1.12, { duration: 3200 }), withTiming(1, { duration: 3200 })),
      -1,
      false,
    );
    scale2.value = withRepeat(
      withSequence(withTiming(1, { duration: 3200 }), withTiming(1.1, { duration: 3200 })),
      -1,
      false,
    );
    scale3.value = withRepeat(
      withSequence(withTiming(1.06, { duration: 4000 }), withTiming(1, { duration: 4000 })),
      -1,
      false,
    );
  }, [reduced, scale1, scale2, scale3]);

  const style1 = useAnimatedStyle(() => ({ transform: [{ scale: scale1.value }] }));
  const style2 = useAnimatedStyle(() => ({ transform: [{ scale: scale2.value }] }));
  const style3 = useAnimatedStyle(() => ({ transform: [{ scale: scale3.value }] }));

  const opacity = OPACITY_BY_DENSITY[density];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View style={[styles.blob1, fill, { opacity: opacity.a }, style1]} />
      <Animated.View style={[styles.blob2, fill, { opacity: opacity.b }, style2]} />
      <Animated.View style={[styles.blob3, fill, { opacity: opacity.c }, style3]} />
    </View>
  );
}

const styles = StyleSheet.create({
  blob1: {
    position: 'absolute',
    width: 380,
    height: 380,
    borderRadius: radius.full,
    // Kept fully below the top edge: an opaque stack header would otherwise
    // cut the disk with a hard line and it would sit over the screen's hero icon.
    top: 140,
    right: -220,
  },
  blob2: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: radius.full,
    bottom: 60,
    left: -70,
  },
  blob3: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: radius.full,
    bottom: 220,
    right: 20,
  },
});
