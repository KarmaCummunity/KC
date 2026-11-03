import React, { useEffect } from 'react';
import { View, Image } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, typography, spacing, radius, Text } from '@kc/ui';
import { AnimatedEntry } from '../../components/animations/AnimatedEntry';
import { MOTION, staggerDelay } from '../../lib/animations/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { aboutWebViewRtl, aboutRtlText } from './aboutWebRtlStyle';

const LOGO = require('../../../assets/logo.png');

function HeroAmbientGlows() {
  const reduced = useReducedMotion();
  const styles = useAboutHeroStyles();
  const phase = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      phase.value = 0;
      return;
    }
    phase.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 3200, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [reduced, phase]);

  const glowAStyle = useAnimatedStyle(() => ({
    opacity: 0.12 + phase.value * 0.12,
    transform: [{ scale: 1 + phase.value * 0.05 }],
  }));
  const glowBStyle = useAnimatedStyle(() => ({
    opacity: 0.06 + (1 - phase.value) * 0.1,
    transform: [{ scale: 1.04 - phase.value * 0.04 }],
  }));

  return (
    <>
      <Animated.View style={[styles.glowA, glowAStyle]} pointerEvents="none" />
      <Animated.View style={[styles.glowB, glowBStyle]} pointerEvents="none" />
    </>
  );
}

export function AboutHero() {
  const { t } = useTranslation();
  const styles = useAboutHeroStyles();

  return (
    <View style={styles.shell}>
      <HeroAmbientGlows />
      <AnimatedEntry
        delay={staggerDelay(0)}
        duration={MOTION.duration.slow}
        distance={16}
        scaleEntrance={0.94}
      >
        <View style={styles.logoWrap}>
          <View style={styles.logoRing}>
            <Image source={LOGO} style={styles.logo} accessibilityLabel={t('aboutContent.title')} />
          </View>
        </View>
      </AnimatedEntry>
      <View style={styles.copyBlock}>
        <AnimatedEntry delay={staggerDelay(1)} duration={MOTION.duration.slow} distance={14} scaleEntrance={0.97}>
          <Text style={styles.eyebrow}>{t('aboutContent.heroEyebrow')}</Text>
        </AnimatedEntry>
        <AnimatedEntry delay={staggerDelay(2)} duration={MOTION.duration.slow} distance={12} scaleEntrance={0.97}>
          <Text style={styles.title}>{t('aboutContent.heroTitle')}</Text>
        </AnimatedEntry>
        <AnimatedEntry delay={staggerDelay(3)} duration={MOTION.duration.slow} distance={10} scaleEntrance={0.98}>
          <Text style={styles.sub}>{t('aboutContent.heroSubtitle')}</Text>
        </AnimatedEntry>
      </View>
    </View>
  );
}

const LOGO_SZ = 88;
const useAboutHeroStyles = makeUseStyles(({ colors }) => ({
  shell: {
    borderRadius: radius.xl,
    paddingVertical: spacing['2xl'],
    paddingHorizontal: spacing.xl,
    alignItems: 'stretch',
    overflow: 'hidden',
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: colors.primaryDark,
  },
  glowA: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: colors.secondary,
    top: -80,
    left: -60,
  },
  glowB: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: colors.warning,
    bottom: -70,
    right: -50,
  },
  logoWrap: { alignSelf: 'center' },
  logoRing: {
    padding: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    marginBottom: spacing.md,
  },
  logo: { width: LOGO_SZ, height: LOGO_SZ, resizeMode: 'contain' },
  copyBlock: {
    width: '100%',
    gap: 0,
    ...aboutWebViewRtl,
  },
  eyebrow: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.88)',
    marginBottom: spacing.xs,
    ...aboutRtlText,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  title: {
    ...typography.h1,
    color: colors.textInverse,
    marginBottom: spacing.sm,
    ...aboutRtlText,
    textShadowColor: 'rgba(0,0,0,0.25)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  sub: {
    ...typography.body,
    color: 'rgba(255,255,255,0.94)',
    ...aboutRtlText,
    lineHeight: 24,
    maxWidth: '100%',
  },
}));
