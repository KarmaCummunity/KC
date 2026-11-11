// FR-CLOSURE (UI extension) — shows who closed the loop on a closed_delivered
// post. Label depends on post.type:
//   • Give    → "delivered to X" (owner gave; marked user is the receiver)
//   • Request → "given by X"     (owner asked for help; marked user is the giver)
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, iconSize, useTheme, Text } from '@kc/ui';
import { MirroredIcon } from '../ui/MirroredIcon';
import type { PostType, VerificationLevel } from '@kc/domain';
import { AvatarWithVerificationBadge } from '../AvatarWithVerificationBadge';
import { NameWithBadge } from '../NameWithBadge';
import { rowDirectionStart, textAlignStart } from '../../lib/rtlLayout';

interface Props {
  readonly postType: PostType;
  readonly recipient: {
    readonly userId: string;
    readonly displayName: string | null;
    readonly shareHandle: string;
    readonly avatarUrl: string | null;
    readonly verificationLevel?: VerificationLevel;
  };
  readonly profileNavigable?: boolean;
}

export function RecipientCallout({ postType, recipient, profileNavigable = true }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const labelLeft = postType === 'Give' ? t('closure.calloutGiveLabel') : t('closure.calloutRequestLabel');
  const sublabel = postType === 'Give' ? t('closure.calloutGiveSublabel') : t('closure.calloutRequestSublabel');
  const displayName = profileNavigable
    ? (recipient.displayName ?? t('profile.fallbackName'))
    : (recipient.displayName || t('post.detail.anonymousUser'));

  const inner = (
    <View style={styles.card}>
      <View style={styles.iconRing}>
        <Ionicons name="checkmark-circle" size={iconSize['2xl']} color={colors.success} />
      </View>
      <View style={styles.textCol}>
        <Text style={styles.sublabel}>{sublabel}</Text>
        <View style={styles.labelRow}>
          <Text style={styles.label} numberOfLines={2}>
            {labelLeft}{' '}
          </Text>
          <NameWithBadge level={profileNavigable ? recipient.verificationLevel : 0}>
            <Text style={styles.name}>{displayName}</Text>
          </NameWithBadge>
        </View>
      </View>
      <AvatarWithVerificationBadge
        name={displayName}
        avatarUrl={profileNavigable ? recipient.avatarUrl : null}
        size={48}
        verificationLevel={profileNavigable ? recipient.verificationLevel : 0}
        emphasis="detail"
      />
      {profileNavigable ? (
        <MirroredIcon name="chevron-forward" size={iconSize.lg} color={colors.textSecondary} />
      ) : null}
    </View>
  );

  if (!profileNavigable) {
    return (
      <View accessibilityLabel={`${labelLeft} ${displayName}`}>
        {inner}
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => router.push(`/user/${recipient.shareHandle}`)}
      accessibilityLabel={`${labelLeft} ${displayName}`}
      accessibilityRole="button"
    >
      {inner}
    </Pressable>
  );
}

const useStyles = makeUseStyles(({ colors, isDark }) => ({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.base,
    backgroundColor: colors.successLight,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: isDark ? `${colors.success}55` : `${colors.success}44`,
  },
  iconRing: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: isDark ? `${colors.success}22` : colors.textInverse,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: { flex: 1, gap: 0, minWidth: 0 },
  labelRow: {
    flexDirection: rowDirectionStart,
    flexWrap: 'wrap' as const,
    alignItems: 'center' as const,
    gap: spacing.xs,
  },
  sublabel: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: textAlignStart(),
    ...typography.semiBold,
  },
  label: {
    ...typography.body,
    color: colors.textPrimary,
    textAlign: textAlignStart(),
    lineHeight: 22,
  },
  name: { ...typography.bold, color: colors.success },
}));
