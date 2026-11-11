import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import { he as dateFnsHe } from 'date-fns/locale';
import type { PostCommentWithAuthor } from '@kc/infrastructure-supabase';
import { makeUseStyles, spacing, typography, iconSize, useTheme, Text } from '@kc/ui';
import { AvatarInitials } from '../AvatarInitials';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

type Props = Readonly<{
  comment: PostCommentWithAuthor;
  nested?: boolean;
  onReply?: () => void;
  onToggleLike?: () => void;
}>;

export function PostCommentRow({ comment, nested, onReply, onToggleLike }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();
  const name = comment.authorDisplayName?.trim() || t('common.deletedUser');
  const timeAgo = formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true, locale: dateFnsHe });

  return (
    <View style={[styles.row, nested ? styles.rowNested : null]}>
      <AvatarInitials name={name} avatarUrl={comment.authorAvatarUrl} size={nested ? 32 : 36} />
      <View style={styles.body}>
        <View style={styles.meta}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.time}>{timeAgo}</Text>
        </View>
        <Text style={styles.text}>{comment.body}</Text>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('post.engagement.commentLike')}
            onPress={onToggleLike}
            style={styles.actionBtn}
          >
            <Ionicons
              name={comment.likedByViewer ? 'heart' : 'heart-outline'}
              size={iconSize.sm}
              color={comment.likedByViewer ? colors.primary : colors.textSecondary}
            />
            {comment.likeCount > 0 ? (
              <Text style={[styles.actionCount, comment.likedByViewer ? styles.actionCountOn : null]}>
                {comment.likeCount}
              </Text>
            ) : null}
          </Pressable>
          {!nested && onReply ? (
            <Pressable accessibilityRole="button" onPress={onReply} style={styles.actionBtn}>
              <Text style={styles.replyLabel}>{t('post.engagement.reply')}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  rowNested: { marginStart: spacing['2xl'], marginTop: spacing.sm },
  body: { flex: 1, minWidth: 0 },
  meta: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginBottom: spacing.xs },
  name: {
    ...typography.label,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    flexShrink: 1,
  },
  time: { ...typography.caption, color: colors.textSecondary },
  text: {
    ...typography.body,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xs },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs },
  actionCount: { ...typography.caption, color: colors.textSecondary },
  actionCountOn: { color: colors.primary, ...typography.semiBold },
  replyLabel: { ...typography.caption, color: colors.textSecondary, ...typography.semiBold },
}));
