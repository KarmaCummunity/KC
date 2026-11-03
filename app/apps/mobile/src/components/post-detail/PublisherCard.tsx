// "Published by" card on a listing page (#1412): the publisher's avatar, name and city, and a
// tap into their profile, the same card the item post page shows (PostDetailScrollContent).
import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { iconSize, makeUseStyles, radius, spacing, Text, typography, useTheme } from '@kc/ui';
import { AvatarInitials } from '../AvatarInitials';
import { rowDirectionStart, textAlignStart } from '../../lib/rtlLayout';
import { MirroredIcon } from '../ui/MirroredIcon';

/** Avatar size of the post page's publisher card. */
const AVATAR_SIZE = 44;

type Props = {
  readonly name: string;
  readonly avatarUrl: string | null;
  /** Hidden when unknown. */
  readonly cityName: string | null;
  /** Share handle or user id of the profile to open; null keeps the card static. */
  readonly profileRef: string | null;
};

export function PublisherCard({ name, avatarUrl, cityName, profileRef }: Props) {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();
  const row = (
    <>
      <AvatarInitials name={name} avatarUrl={avatarUrl} size={AVATAR_SIZE} />
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        {cityName ? <Text style={styles.city}>{cityName}</Text> : null}
      </View>
    </>
  );

  return (
    <View style={styles.card} testID="listing-publisher-card">
      <Text style={styles.label}>{t('post.detail.publishedBy')}</Text>
      {profileRef ? (
        <TouchableOpacity
          style={styles.row}
          accessibilityRole="button"
          onPress={() => router.push(`/user/${profileRef}`)}
        >
          {row}
          <MirroredIcon name="chevron-forward" size={iconSize.lg} color={colors.textSecondary} />
        </TouchableOpacity>
      ) : (
        <View style={styles.row}>{row}</View>
      )}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors, isDark }) => ({
  card: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: isDark ? colors.surfaceRaised : colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: {
    ...typography.caption,
    ...typography.semiBold,
    color: colors.textDisabled,
    textAlign: textAlignStart(),
    marginBottom: spacing.xs,
  },
  row: { flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.md },
  info: { flex: 1, gap: spacing.xs },
  name: { ...typography.body, ...typography.semiBold, color: colors.textPrimary, textAlign: textAlignStart() },
  city: { ...typography.caption, color: colors.textSecondary, textAlign: textAlignStart() },
}));
