import React, { useState } from 'react';
import { View, Pressable } from 'react-native';
import { WebView } from 'react-native-webview';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, typography, spacing, radius, useTheme, Text } from '@kc/ui';
import { Ionicons } from '@expo/vector-icons';
import { AnimatedEntry } from '../../components/animations/AnimatedEntry';
import { MOTION, staggerDelay } from '../../lib/animations/motion';
import { ABOUT_INSTAGRAM_EMBED_URL, ABOUT_INSTAGRAM_PROFILE_URL } from './aboutExternalLinks';
import { aboutOpenExternalUrl } from './aboutOpenExternalUrl';
import { aboutWebTextRtl, aboutRtlRow } from './aboutWebRtlStyle';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

export interface AboutInstagramEmbedProps {
  readonly title: string;
  readonly caption: string;
  readonly openLabel: string;
  readonly embedNote: string;
  readonly webFallbackTitle?: string;
}

export function AboutInstagramEmbed({
  title,
  caption,
  openLabel,
  embedNote,
  webFallbackTitle: _webFallbackTitle,
}: AboutInstagramEmbedProps) {
  const { t } = useTranslation();
  const styles = useAboutInstagramEmbedStyles();
  const { colors } = useTheme();
  const [embedFailed, setEmbedFailed] = useState(false);

  const openProfile = () =>
    void aboutOpenExternalUrl(ABOUT_INSTAGRAM_PROFILE_URL, t('aboutContent.contactLinkError'));

  return (
    <View style={styles.wrap}>
      <AnimatedEntry delay={staggerDelay(0)} duration={MOTION.duration.base} distance={10} scaleEntrance={0.98}>
        <Text style={styles.title}>{title}</Text>
      </AnimatedEntry>
      <AnimatedEntry delay={staggerDelay(1)} duration={MOTION.duration.base} distance={8} scaleEntrance={0.99}>
        <Text style={styles.caption}>{caption}</Text>
      </AnimatedEntry>
      {!embedFailed ? (
        <AnimatedEntry delay={staggerDelay(2)} duration={MOTION.duration.base} distance={6}>
          <View style={styles.frame}>
            <WebView
              source={{ uri: ABOUT_INSTAGRAM_EMBED_URL }}
              style={styles.web}
              scrollEnabled
              originWhitelist={['https://*']}
              onShouldStartLoadWithRequest={(req) => req.url.startsWith('https://')}
              onError={() => setEmbedFailed(true)}
              onHttpError={() => setEmbedFailed(true)}
              accessibilityLabel={title}
            />
          </View>
        </AnimatedEntry>
      ) : (
        <AnimatedEntry delay={staggerDelay(2)} duration={MOTION.duration.slow} distance={4}>
          <Text style={styles.note}>{embedNote}</Text>
        </AnimatedEntry>
      )}
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
  title: { ...typography.h4, color: colors.textPrimary, textAlign: rtlTextAlignStart, ...aboutWebTextRtl },
  caption: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    ...aboutWebTextRtl,
    lineHeight: 24,
  },
  frame: {
    height: 420,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  web: { flex: 1, backgroundColor: colors.surface },
  note: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart, ...aboutWebTextRtl },
  cta: {
    flexDirection: aboutRtlRow,
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
