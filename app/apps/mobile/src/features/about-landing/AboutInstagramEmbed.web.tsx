import React from 'react';
import { View, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, typography, spacing, radius, useTheme, Text } from '@kc/ui';
import { Ionicons } from '@expo/vector-icons';
import { AnimatedEntry } from '../../components/animations/AnimatedEntry';
import { MOTION, staggerDelay } from '../../lib/animations/motion';
import { ABOUT_INSTAGRAM_PROFILE_URL } from './aboutExternalLinks';
import { aboutOpenExternalUrl } from './aboutOpenExternalUrl';
import { aboutWebTextRtl } from './aboutWebRtlStyle';

export interface AboutInstagramEmbedProps {
  readonly title: string;
  readonly caption: string;
  readonly openLabel: string;
  readonly embedNote: string;
  readonly webFallbackTitle?: string;
}

/** Web: static card + external open CTA (no embedded browser module). */
export function AboutInstagramEmbed({
  title,
  caption,
  openLabel,
  embedNote,
  webFallbackTitle,
}: AboutInstagramEmbedProps) {
  const { t } = useTranslation();
  const styles = useAboutInstagramEmbedStyles();
  const { colors } = useTheme();

  const openProfile = () =>
    void aboutOpenExternalUrl(ABOUT_INSTAGRAM_PROFILE_URL, t('aboutContent.contactLinkError'));

  return (
    <View style={styles.wrap}>
      <AnimatedEntry delay={staggerDelay(0)} duration={MOTION.duration.base} distance={10} scaleEntrance={0.98}>
        <Text style={styles.title}>{webFallbackTitle ?? title}</Text>
      </AnimatedEntry>
      <AnimatedEntry delay={staggerDelay(1)} duration={MOTION.duration.base} distance={8} scaleEntrance={0.99}>
        <Text style={styles.caption}>{caption}</Text>
      </AnimatedEntry>
      <AnimatedEntry delay={staggerDelay(2)} duration={MOTION.duration.base} distance={6}>
        <Text style={styles.note}>{embedNote}</Text>
      </AnimatedEntry>
      <AnimatedEntry delay={staggerDelay(3)} duration={MOTION.duration.base} distance={8} scaleEntrance={0.97}>
        <Pressable
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          onPress={openProfile}
          accessibilityRole="link"
        >
          <Ionicons name="logo-instagram" size={22} color={colors.textInverse} />
          <Text style={styles.ctaText}>{openLabel}</Text>
        </Pressable>
      </AnimatedEntry>
    </View>
  );
}

const useAboutInstagramEmbedStyles = makeUseStyles(({ colors }) => ({
  wrap: { gap: spacing.md },
  title: { ...typography.h4, color: colors.textPrimary, textAlign: 'right', ...aboutWebTextRtl },
  caption: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'right',
    ...aboutWebTextRtl,
    lineHeight: 24,
  },
  note: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'right',
    ...aboutWebTextRtl,
    lineHeight: 20,
  },
  cta: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  ctaPressed: { opacity: 0.9 },
  ctaText: { ...typography.button, color: colors.textInverse, ...aboutWebTextRtl },
}));
