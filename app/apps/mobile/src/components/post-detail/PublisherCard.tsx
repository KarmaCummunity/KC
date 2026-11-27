// Shared "Published by" card (#1412, #1809 / TD-257): avatar, name, city, tap into profile.
// Listing pages and the post detail page both use this; props cover the few real differences
// (chevron size, name truncation) so look and behaviour stay the same at each call site.
import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { iconSize, Text, useTheme } from '@kc/ui';
import type { VerificationLevel } from '@kc/domain';
import { AvatarWithVerificationBadge } from '../AvatarWithVerificationBadge';
import { NameWithBadge } from '../NameWithBadge';
import { MirroredIcon } from '../ui/MirroredIcon';
import { usePostDetailStyles } from '../../screens/post/postDetailScreen.styles';

/** Avatar size shared by listing and post-detail publisher cards. */
const AVATAR_SIZE = 40;

type Props = {
  readonly name: string;
  readonly avatarUrl: string | null;
  /** Hidden when unknown. */
  readonly cityName: string | null;
  /** Share handle or user id of the profile to open; null keeps the card static. */
  readonly profileRef: string | null;
  readonly verificationLevel?: VerificationLevel;
  /**
   * Chevron size when the row is tappable.
   * Listing cards use md; the post page historically used lg (#1809).
   */
  readonly chevronSize?: number;
  /**
   * Name line clamp. Listing cards clamp to 1; pass `null` for no clamp (post page).
   */
  readonly nameNumberOfLines?: number | null;
  readonly testID?: string;
};

export function PublisherCard({
  name,
  avatarUrl,
  cityName,
  profileRef,
  verificationLevel,
  chevronSize = iconSize.md,
  nameNumberOfLines = 1,
  testID = 'listing-publisher-card',
}: Props) {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = usePostDetailStyles();
  const nameProps = nameNumberOfLines == null ? {} : { numberOfLines: nameNumberOfLines };
  const row = (
    <>
      <AvatarWithVerificationBadge
        name={name}
        avatarUrl={avatarUrl}
        size={AVATAR_SIZE}
        verificationLevel={verificationLevel}
        emphasis="detail"
      />
      <View style={styles.authorInfo}>
        <NameWithBadge level={verificationLevel}>
          <Text style={styles.authorName} {...nameProps}>{name}</Text>
        </NameWithBadge>
        {cityName ? <Text style={styles.authorCity}>{cityName}</Text> : null}
      </View>
    </>
  );

  return (
    <View style={styles.authorCard} testID={testID}>
      <Text style={styles.authorLabel}>{t('post.detail.publishedBy')}</Text>
      {profileRef ? (
        <TouchableOpacity
          style={styles.authorRow}
          accessibilityRole="button"
          onPress={() => router.push(`/user/${profileRef}`)}
        >
          {row}
          <MirroredIcon name="chevron-forward" size={chevronSize} color={colors.textSecondary} />
        </TouchableOpacity>
      ) : (
        <View style={styles.authorRow}>{row}</View>
      )}
    </View>
  );
}
