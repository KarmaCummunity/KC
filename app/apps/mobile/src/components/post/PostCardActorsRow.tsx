// Feed card — tappable owner (+ counterparty on closed_delivered) without opening the post.
import React, { useCallback } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, iconSize, useTheme, Text } from '@kc/ui';
import type { PostWithOwner } from '@kc/application';
import type { VerificationLevel } from '@kc/domain';
import { AvatarWithVerificationBadge } from '../AvatarWithVerificationBadge';
import { MirroredIcon } from '../ui/MirroredIcon';
import { postOwnerDisplayLabel } from '../../lib/postOwnerDisplayLabel';
import { postRecipientDisplayLabel } from '../../lib/postRecipientDisplayLabel';

const AVATAR = 24;

type ActorProps = {
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly handle: string;
  readonly navigable: boolean;
  readonly verificationLevel?: VerificationLevel;
  readonly paired: boolean;
  readonly testID: string;
};

function ActorChip({ name, avatarUrl, handle, navigable, verificationLevel, paired, testID }: ActorProps) {
  const router = useRouter();
  const styles = useStyles();
  const onPress = useCallback(() => {
    if (navigable && handle.trim()) router.push(`/user/${handle}`);
  }, [handle, navigable, router]);

  const body = (
    <>
      <AvatarWithVerificationBadge
        name={name}
        avatarUrl={avatarUrl}
        size={AVATAR}
        verificationLevel={verificationLevel}
      />
      <Text
        style={[styles.name, navigable && handle.trim() ? styles.nameLink : null]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {name}
      </Text>
    </>
  );

  const chipStyle = paired ? styles.chipPaired : styles.chip;

  if (!navigable || !handle.trim()) {
    return (
      <View style={chipStyle} accessibilityLabel={name} testID={testID}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      style={chipStyle}
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={name}
      testID={testID}
    >
      {body}
    </Pressable>
  );
}

export function PostCardActorsRow({ post }: Readonly<{ post: PostWithOwner }>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();
  const ownerNav = post.ownerProfileNavigableFromPost !== false;
  const ownerLabel = postOwnerDisplayLabel(post, t);
  const closed = post.status === 'closed_delivered';
  const recipient = post.recipientUser;
  const recipientNav = (post.recipientProfileNavigableFromPost ?? true) === true;
  const showCounterparty = closed && recipient != null;

  return (
    <View
      style={styles.row}
      onStartShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
    >
      <ActorChip
        name={ownerLabel}
        avatarUrl={post.ownerAvatarUrl}
        handle={post.ownerHandle}
        navigable={ownerNav}
        verificationLevel={post.ownerVerificationLevel}
        paired={showCounterparty}
        testID="post-card-owner"
      />
      {showCounterparty ? (
        <>
          <MirroredIcon name="arrow-forward" size={iconSize.xs} color={colors.textSecondary} />
          <ActorChip
            name={postRecipientDisplayLabel(recipient, recipientNav, t)}
            avatarUrl={recipientNav ? recipient.avatarUrl : null}
            handle={recipient.shareHandle}
            navigable={recipientNav}
            paired
            testID="post-card-counterparty"
          />
        </>
      ) : null}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexWrap: 'wrap',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flex: 1,
    minWidth: 0,
    maxWidth: '100%',
  },
  chipPaired: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flex: 1,
    minWidth: 0,
    maxWidth: '46%',
  },
  name: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    fontSize: 12,
  },
  nameLink: {
    color: colors.primary,
    textDecorationLine: 'underline',
  },
}));
