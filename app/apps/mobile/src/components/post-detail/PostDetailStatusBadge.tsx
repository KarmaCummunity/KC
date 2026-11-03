// Status pill on post-detail hero — distinguishes open vs closed at a glance.
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { PostStatus } from '@kc/domain';
import { iconSize, makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';

type Props = Readonly<{
  status: PostStatus;
}>;

export function PostDetailStatusBadge({ status }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();

  if (status === 'open') {
    return (
      <View style={[styles.pill, styles.pillOpen]} accessibilityRole="text">
        <View style={styles.openDot} />
        <Text style={styles.pillTextOpen}>{t('post.detail.statusOpen')}</Text>
      </View>
    );
  }

  if (status === 'closed_delivered') {
    return (
      <View style={[styles.pill, styles.pillClosed]} accessibilityRole="text">
        <Ionicons name="checkmark-circle" size={iconSize.sm} color={colors.success} />
        <Text style={styles.pillTextClosed}>{t('post.detail.statusClosed')}</Text>
      </View>
    );
  }

  if (status === 'deleted_no_recipient') {
    return (
      <View style={[styles.pill, styles.pillPending]} accessibilityRole="text">
        <Ionicons name="time-outline" size={iconSize.sm} color={colors.warning} />
        <Text style={styles.pillTextPending}>{t('post.detail.statusPendingDelete')}</Text>
      </View>
    );
  }

  if (status === 'expired') {
    return (
      <View style={[styles.pill, styles.pillPending]} accessibilityRole="text">
        <Ionicons name="time-outline" size={iconSize.sm} color={colors.warning} />
        <Text style={styles.pillTextPending}>{t('post.detail.statusExpired')}</Text>
      </View>
    );
  }

  if (status === 'hidden_pending_review') {
    return (
      <View style={[styles.pill, styles.pillPending]} accessibilityRole="text">
        <Ionicons name="eye-off-outline" size={iconSize.sm} color={colors.warning} />
        <Text style={styles.pillTextPending}>{t('post.detail.statusHiddenForReview')}</Text>
      </View>
    );
  }

  if (status === 'removed_admin') {
    return (
      <View style={[styles.pill, styles.pillRemoved]} accessibilityRole="text">
        <Ionicons name="shield-outline" size={iconSize.sm} color={colors.error} />
        <Text style={styles.pillTextRemoved}>{t('post.detail.statusRemovedAdmin')}</Text>
      </View>
    );
  }

  return null;
}

// Hex alpha suffix (~40%) appended to the tone color for the pill border.
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
  pillClosed: { borderColor: `${colors.success}${PILL_BORDER_ALPHA}` },
  pillPending: { borderColor: `${colors.warning}${PILL_BORDER_ALPHA}` },
  pillRemoved: { borderColor: `${colors.error}${PILL_BORDER_ALPHA}` },
  openDot: {
    width: 8,
    height: 8,
    borderRadius: radius.xs,
    backgroundColor: colors.primary,
  },
  pillTextOpen: { ...typography.label, ...typography.bold, color: colors.primary },
  pillTextClosed: { ...typography.label, ...typography.bold, color: colors.success },
  pillTextPending: { ...typography.label, ...typography.bold, color: colors.warning },
  pillTextRemoved: { ...typography.label, ...typography.bold, color: colors.error },
}));
