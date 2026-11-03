// Lifecycle + visibility notices on the post-detail screen — surfaced to any
// viewer who can still see the post (owner or permitted follower / admin).
// Mapped to FR-POST-014 (viewer detail), FR-POST-015 AC2/AC3 (visibility banners).
import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { iconSize, makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import type { PostWithOwner } from '@kc/application';
import { textAlignStart } from '../../lib/rtlLayout';

// Hex alpha suffix (~33%) appended to the tone color for a subtle banner border.
const NOTICE_BORDER_ALPHA = '55';

type NoticeTone = 'danger' | 'warning' | 'info';

type Notice = Readonly<{
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  tone: NoticeTone;
}>;

function collectNotices(
  post: PostWithOwner,
  t: (key: string) => string,
): readonly Notice[] {
  const notices: Notice[] = [];
  if (post.status === 'removed_admin') {
    notices.push({ key: 'removed', icon: 'shield-outline', text: t('post.detail.removedAdminNotice'), tone: 'danger' });
  }
  if (post.status === 'hidden_pending_review') {
    notices.push({ key: 'hidden', icon: 'eye-off-outline', text: t('post.detail.hiddenForReviewNotice'), tone: 'warning' });
  }
  if (post.status === 'expired') {
    notices.push({ key: 'expired', icon: 'time-outline', text: t('post.detail.expiredNotice'), tone: 'warning' });
  }
  if (post.visibility === 'FollowersOnly') {
    notices.push({ key: 'followers', icon: 'people-outline', text: t('post.detail.visibilityFollowersNotice'), tone: 'info' });
  }
  if (post.visibility === 'OnlyMe') {
    notices.push({ key: 'onlyme', icon: 'lock-closed-outline', text: t('post.detail.visibilityOnlyMeNotice'), tone: 'info' });
  }
  return notices;
}

export function PostDetailNotices({ post }: Readonly<{ post: PostWithOwner }>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();
  const notices = collectNotices(post, t);
  if (notices.length === 0) return null;

  const toneColor = (tone: NoticeTone) =>
    tone === 'danger' ? colors.error : tone === 'warning' ? colors.warning : colors.primary;

  return (
    <View style={styles.wrap}>
      {notices.map((n) => (
        <View
          key={n.key}
          style={[styles.banner, { borderColor: `${toneColor(n.tone)}${NOTICE_BORDER_ALPHA}` }]}
          accessibilityRole="alert"
          accessibilityLabel={n.text}
        >
          <Ionicons name={n.icon} size={iconSize.sm} color={toneColor(n.tone)} />
          <Text style={[styles.text, { color: toneColor(n.tone) }]}>{n.text}</Text>
        </View>
      ))}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  wrap: { gap: spacing.xs },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    backgroundColor: colors.background,
  },
  text: {
    ...typography.caption,
    ...typography.semiBold,
    flex: 1,
    textAlign: textAlignStart(),
  },
}));
