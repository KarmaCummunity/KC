// "Published by" card on a listing page (#1412): the publisher's avatar, name and city, and a
// tap into their profile, the same card the item post page shows (PostDetailScrollContent).
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

/** Avatar size of the post page's publisher card. */
const AVATAR_SIZE = 40;

type Props = {
  readonly name: string;
  readonly avatarUrl: string | null;
  /** Hidden when unknown. */
  readonly cityName: string | null;
  /** Share handle or user id of the profile to open; null keeps the card static. */
  readonly profileRef: string | null;
  readonly verificationLevel?: VerificationLevel;
};

export function PublisherCard({ name, avatarUrl, cityName, profileRef, verificationLevel }: Props) {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = usePostDetailStyles();
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
          <Text style={styles.authorName} numberOfLines={1}>{name}</Text>
        </NameWithBadge>
        {cityName ? <Text style={styles.authorCity}>{cityName}</Text> : null}
      </View>
    </>
  );

  return (
    <View style={styles.authorCard} testID="listing-publisher-card">
      <Text style={styles.authorLabel}>{t('post.detail.publishedBy')}</Text>
      {profileRef ? (
        <TouchableOpacity
          style={styles.authorRow}
          accessibilityRole="button"
          onPress={() => router.push(`/user/${profileRef}`)}
        >
          {row}
          <MirroredIcon name="chevron-forward" size={iconSize.md} color={colors.textSecondary} />
        </TouchableOpacity>
      ) : (
        <View style={styles.authorRow}>{row}</View>
      )}
    </View>
  );
}
