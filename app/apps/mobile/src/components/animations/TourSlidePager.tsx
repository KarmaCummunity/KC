import React, { useEffect } from 'react';
import { View, useWindowDimensions, I18nManager } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { makeUseStyles, typography, spacing, radius, useTheme, Text } from '@kc/ui';
import { MOTION } from '../../lib/animations/motion';
import { EASINGS } from '../../lib/animations/motion-easings';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { HeroHalo } from './HeroHalo';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export interface TourSlide {
  readonly icon: IoniconName;
  readonly title: string;
  readonly body: string;
}

export interface TourSlidePagerProps {
  readonly slides: readonly TourSlide[];
  readonly index: number;
  readonly onIndexChange: (next: number) => void;
}

const SWIPE_THRESHOLD = 60;
const HALO_SIZE = 144;
const ICON_SIZE = 56;

export function TourSlidePager({ slides, index, onIndexChange }: TourSlidePagerProps) {
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const styles = useTourSlidePagerStyles();
  const { colors } = useTheme();
  const tx = useSharedValue(0);
  const iconScale = useSharedValue(1);
  const direction = I18nManager.isRTL ? -1 : 1;

  useEffect(() => {
    const d = reduced ? 0 : MOTION.duration.base;
    tx.value = withTiming(0, { duration: d, easing: EASINGS.easeOut });
    if (!reduced) {
      iconScale.value = 0.7;
      iconScale.value = withSpring(1, MOTION.spring);
    }
  }, [index, reduced, tx, iconScale]);

  const commit = (next: number) => {
    if (next < 0 || next >= slides.length) {
      tx.value = withTiming(0, { duration: MOTION.duration.fast });
      return;
    }
    onIndexChange(next);
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-15, 15])
    .onUpdate((e) => {
      tx.value = e.translationX;
    })
    .onEnd((e) => {
      const dx = e.translationX * direction;
      if (dx < -SWIPE_THRESHOLD) runOnJS(commit)(index + 1);
      else if (dx > SWIPE_THRESHOLD) runOnJS(commit)(index - 1);
      else tx.value = withTiming(0, { duration: MOTION.duration.fast });
    });

  const trackStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
  }));
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
  }));

  const slide = slides[index]!;

  return (
    <View style={styles.wrap}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.content, trackStyle, { width }]}>
          <Animated.View style={iconStyle}>
            <HeroHalo size={HALO_SIZE}>
              <Ionicons name={slide.icon} size={ICON_SIZE} color={colors.primaryDark} />
            </HeroHalo>
          </Animated.View>
          <Text style={styles.title}>{slide.title}</Text>
          <Text style={styles.body}>{slide.body}</Text>
        </Animated.View>
      </GestureDetector>
      <View style={styles.dots}>
        {slides.map((_, i) => (
          <Dot key={i} active={i === index} />
        ))}
      </View>
    </View>
  );
}

function Dot({ active }: { active: boolean }) {
  const reduced = useReducedMotion();
  const styles = useTourSlidePagerStyles();
  const { colors } = useTheme();
  const w = useSharedValue(active ? 24 : 8);

  useEffect(() => {
    const d = reduced ? 0 : MOTION.duration.base;
    w.value = withTiming(active ? 24 : 8, { duration: d, easing: EASINGS.easeOut });
  }, [active, reduced, w]);

  const dotStyle = useAnimatedStyle(() => ({
    width: w.value,
    backgroundColor: active ? colors.primary : colors.border,
  }));

  return <Animated.View style={[styles.dot, dotStyle]} />;
}

const useTourSlidePagerStyles = makeUseStyles(({ colors }) => ({
  wrap: { flex: 1, alignItems: 'center' },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
  },
  title: {
    ...typography.h1,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    ...typography.bodyLarge,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.sm,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    marginBottom: spacing.base,
  },
  dot: {
    height: 8,
    borderRadius: radius.xs,
  },
}));
