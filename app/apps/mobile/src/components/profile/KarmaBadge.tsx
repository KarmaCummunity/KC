// FR-KARMA-007 — self-only karma number + "how to earn" explainer.
import { useState } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { iconSize, makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { rowDirectionStart, selfAlignStart } from '../../lib/rtlLayout';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { GhostButton } from '../ui/Buttons';
import { Modal } from '../ui/Modal';

const EARN_RULES = ['earnRegistration', 'earnPost', 'earnOutreach', 'earnFollower', 'earnClosure'] as const;

export function KarmaBadge({ points }: { readonly points: number }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useKarmaBadgeStyles();
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const close = () => setOpen(false);
  return (
    <>
      <TouchableOpacity
        style={styles.badge}
        onPress={() => router.push('/karma-history')}
        accessibilityRole="button"
        accessibilityHint={t('karma.historyOpen')}
      >
        <Ionicons name="sparkles" size={iconSize.md} color={colors.primary} />
        <Text style={styles.points}>{points}</Text>
        <Text style={styles.label}>{t('karma.badgeLabel')}</Text>
        <TouchableOpacity onPress={() => setOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('karma.howToEarnTitle')}>
          <Ionicons name="information-circle-outline" size={iconSize.sm} color={colors.textSecondary} />
        </TouchableOpacity>
      </TouchableOpacity>
      <Modal
        visible={open}
        title={t('karma.howToEarnTitle')}
        onDismiss={close}
        footer={<GhostButton label={t('karma.close')} size="md" fullWidth onPress={close} />}
      >
        <View style={styles.rules}>
          <Text style={styles.intro}>{t('karma.howToEarnIntro')}</Text>
          {EARN_RULES.map((k) => (
            <Text key={k} style={styles.rule}>• {t(`karma.${k}`)}</Text>
          ))}
        </View>
      </Modal>
    </>
  );
}

const useKarmaBadgeStyles = makeUseStyles(({ colors }) => ({
  badge: {
    // Lay the row from the reading-start edge so the number reads before the
    // label in both Hebrew (RTL) and English (LTR). rowDirectionStart avoids the
    // native forceRTL double-flip a raw 'row-reverse' triggers (see lib/rtlLayout.ts).
    flexDirection: rowDirectionStart,
    alignItems: 'center' as const,
    gap: spacing.xs,
    // Hug the reading-start edge: right in Hebrew (RTL), left in English (LTR).
    alignSelf: selfAlignStart,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.primarySurface,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.primaryLight,
  },
  points: { ...typography.h4, color: colors.primary },
  label: { ...typography.caption, color: colors.textPrimary },
  rules: { gap: spacing.xs },
  intro: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  rule: { ...typography.body, color: colors.textPrimary, textAlign: rtlTextAlignStart },
}));
