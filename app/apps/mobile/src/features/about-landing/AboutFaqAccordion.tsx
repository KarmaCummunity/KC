// FAQ accordion with Reanimated expand/collapse + chevron rotation.
import React, { useState, useCallback } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { makeUseStyles, typography, spacing, radius, useTheme, Text, iconSize } from '@kc/ui';
import { aboutRtlText, aboutRtlRow } from './aboutWebRtlStyle';
import { MOTION } from '../../lib/animations/motion';

interface FaqItem {
  readonly q: string;
  readonly a: string;
}

interface RowProps {
  readonly item: FaqItem;
  readonly isLast: boolean;
}

function FaqRow({ item, isLast }: RowProps) {
  const [open, setOpen] = useState(false);
  const styles = useAboutFaqAccordionStyles();
  const { colors } = useTheme();
  const rot = useSharedValue(0);
  const opacity = useSharedValue(0);

  const toggle = useCallback(() => {
    const next = !open;
    setOpen(next);
    rot.value = withTiming(next ? 1 : 0, { duration: MOTION.duration.fast });
    opacity.value = withTiming(next ? 1 : 0, { duration: MOTION.duration.base });
  }, [open, rot, opacity]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rot.value * 180}deg` }],
  }));
  const answerStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <View style={[styles.row, !isLast && styles.rowBorder]}>
      <TouchableOpacity style={styles.question} onPress={toggle} activeOpacity={0.7}>
        <Animated.View style={chevronStyle}>
          <Ionicons name="chevron-down" size={iconSize.lg} color={colors.primary} />
        </Animated.View>
        <Text style={styles.q}>{item.q}</Text>
      </TouchableOpacity>
      {open && (
        <Animated.View style={[styles.answer, answerStyle]}>
          <Text style={styles.a}>{item.a}</Text>
        </Animated.View>
      )}
    </View>
  );
}

export function AboutFaqAccordion() {
  const { t } = useTranslation();
  const styles = useAboutFaqAccordionStyles();
  const items: FaqItem[] = t('aboutContent.faqItems', { returnObjects: true }) as FaqItem[];

  return (
    <View style={styles.list}>
      {items.map((it, i) => (
        <FaqRow key={it.q} item={it} isLast={i === items.length - 1} />
      ))}
    </View>
  );
}

const useAboutFaqAccordionStyles = makeUseStyles(({ colors }) => ({
  list: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  row: { paddingHorizontal: spacing.md },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  question: {
    flexDirection: aboutRtlRow,
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  q: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
    ...aboutRtlText,
    ...typography.semiBold,
  },
  answer: { paddingBottom: spacing.md },
  a: {
    ...typography.body,
    color: colors.textSecondary,
    ...aboutRtlText,
    lineHeight: 22,
  },
}));
