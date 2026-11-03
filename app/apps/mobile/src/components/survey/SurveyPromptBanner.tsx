// SurveyPromptBanner — slim card shown above the feed when the user is eligible.
// Mapped to: FR-SETTINGS-016 AC6. Hebrew RTL. Non-sticky (scrolls with content).
import React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { Card } from '../ui/Card';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

interface SurveyPromptBannerProps {
  readonly slug: string;
  readonly onSnooze: () => Promise<void>;
}

export function SurveyPromptBanner({ slug, onSnooze }: SurveyPromptBannerProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useBannerStyles();

  const handleOpen = () => {
    void onSnooze(); // dismiss banner before navigating
    router.push(`/settings/survey/${slug}`);
  };

  const handleSnooze = () => {
    void onSnooze();
  };

  return (
    <View style={styles.outer}>
      <Card padding="sm" style={styles.card}>
        <View style={styles.row}>
          <View style={styles.textBlock}>
            <Text style={styles.title}>{t('survey.bannerTitle')}</Text>
            <Text style={styles.body}>{t('survey.bannerBody')}</Text>
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable
            style={[styles.btn, styles.btnPrimary]}
            onPress={handleOpen}
            accessibilityRole="button"
            accessibilityLabel={t('survey.bannerCta')}
          >
            <Text style={[styles.btnText, styles.btnPrimaryText]}>
              {t('survey.bannerCta')}
            </Text>
          </Pressable>

          <Pressable
            style={styles.snoozeBtn}
            onPress={handleSnooze}
            accessibilityRole="button"
            hitSlop={8}
          >
            <Text style={styles.snoozeText}>{t('survey.bannerSnooze')}</Text>
          </Pressable>
        </View>
      </Card>
    </View>
  );
}

const useBannerStyles = makeUseStyles(({ colors }) => ({
  outer: {
    marginHorizontal: spacing.base,
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  card: { gap: spacing.sm },
  row: {
    flexDirection: rowDirectionStart,
    alignItems: 'flex-start' as const,
    gap: spacing.sm,
  },
  textBlock: { flex: 1, gap: spacing.xs },
  title: {
    ...typography.bodySmall,
    ...typography.bold,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
  },
  body: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
  },
  actions: {
    flexDirection: rowDirectionStart,
    alignItems: 'center' as const,
    gap: spacing.sm,
  },
  btn: {
    height: 36,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnText: { ...typography.caption, ...typography.bold },
  btnPrimaryText: { color: colors.textInverse },
  snoozeBtn: { paddingVertical: spacing.xs },
  snoozeText: {
    ...typography.caption,
    color: colors.textSecondary,
    textDecorationLine: 'underline' as const,
  },
}));
