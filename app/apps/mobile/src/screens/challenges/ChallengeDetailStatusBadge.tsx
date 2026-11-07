import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { iconSize, makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';

type Props = Readonly<{
  active: boolean;
}>;

/** Hero status pill for a challenge detail — open vs ended (maps to post pause when ended). */
export function ChallengeDetailStatusBadge({ active }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();

  if (active) {
    return (
      <View style={[styles.pill, styles.pillOpen]} accessibilityRole="text">
        <View style={styles.openDot} />
        <Text style={styles.pillTextOpen}>{t('post.detail.statusOpen')}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.pill, styles.pillEnded]} accessibilityRole="text">
      <Ionicons name="flag-outline" size={iconSize.sm} color={colors.textSecondary} />
      <Text style={styles.pillTextEnded}>{t('challenges.endedTag')}</Text>
    </View>
  );
}

const PILL_BORDER_ALPHA = '66';

const useStyles = makeUseStyles(({ colors }) => ({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  pillOpen: { borderColor: `${colors.primaryVivid}${PILL_BORDER_ALPHA}` },
  pillEnded: { borderColor: `${colors.border}${PILL_BORDER_ALPHA}` },
  openDot: {
    width: 8,
    height: 8,
    borderRadius: radius.xs,
    backgroundColor: colors.primary,
  },
  pillTextOpen: { ...typography.label, ...typography.bold, color: colors.primary },
  pillTextEnded: { ...typography.label, ...typography.bold, color: colors.textSecondary },
}));
