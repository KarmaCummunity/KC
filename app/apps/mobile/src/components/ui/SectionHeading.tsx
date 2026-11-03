// SectionHeading — large hero-style title + optional subtitle/eyebrow.
// Mirrors the welcome-screen title typography (32px, letter-spacing -0.5,
// near-black slate) so any redesigned main screen can lead with the same
// presence.
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

interface SectionHeadingProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly align?: 'right' | 'center';
  readonly style?: StyleProp<ViewStyle>;
}

export function SectionHeading({
  title,
  subtitle,
  align = 'right',
  style,
}: SectionHeadingProps) {
  const styles = useStyles();
  return (
    <View style={[align === 'center' ? styles.center : styles.right, style]}>
      <Text style={[styles.title, align === 'center' && styles.titleCentered]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.subtitle, align === 'center' && styles.subtitleCentered]}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors, isDark: _isDark }) => ({
  right: { alignItems: 'flex-end' },
  center: { alignItems: 'center' },
  title: {
    ...typography.h1,
    fontSize: 32,
    color: colors.textPrimary,
    letterSpacing: -0.5,
    textAlign: rtlTextAlignStart,
  },
  titleCentered: { textAlign: 'center' },
  subtitle: {
    ...typography.bodyLarge,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    textAlign: rtlTextAlignStart,
  },
  subtitleCentered: { textAlign: 'center' },
}));
