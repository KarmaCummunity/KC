import React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, radius, iconSize, useTheme, Text } from '@kc/ui';
import { rtlTextAlignStart, rowDirectionStart } from '../../lib/rtlLayout';
import { usePostEngagement } from './PostEngagementContext';
import { PostCommentRow } from './PostCommentRow';

export function PostEngagementThread() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();
  const engagement = usePostEngagement();
  if (!engagement) return null;

  const { stats, activeReaction, threads, commentsLoaded, commentsFailed, visibleCommentCount, busy, onReaction, onReply, onToggleCommentLike } = engagement;
  const liked = activeReaction === 'like';

  return (
    <View style={styles.wrap} testID="post-engagement-section">
      <View style={styles.toolbar}>
        <Text style={styles.heading} accessibilityRole="header">
          {t('post.engagement.titleWithCount', { count: visibleCommentCount })}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('post.engagement.reaction.like')}
          accessibilityState={{ selected: liked }}
          style={({ pressed }) => [
            styles.likeBtn,
            liked ? styles.likeBtnOn : null,
            pressed ? styles.likeBtnPressed : null,
          ]}
          onPress={() => onReaction('like')}
          disabled={busy}
        >
          <Ionicons
            name={liked ? 'heart' : 'heart-outline'}
            size={iconSize.lg}
            color={liked ? colors.primary : colors.textSecondary}
          />
          {stats.reactionCount > 0 ? (
            <Text style={[styles.likeCount, liked ? styles.likeCountOn : null]}>{stats.reactionCount}</Text>
          ) : null}
        </Pressable>
        {busy ? <ActivityIndicator size="small" style={styles.spinner} /> : null}
      </View>

      {!commentsLoaded ? (
        <ActivityIndicator style={styles.spinner} />
      ) : commentsFailed ? (
        <Text style={styles.empty}>{t('post.engagement.loadError')}</Text>
      ) : threads.length === 0 ? (
        <Text style={styles.empty}>{t('post.engagement.emptyComments')}</Text>
      ) : (
        <View style={styles.threadList}>
          {threads.map((thread) => (
            <View key={thread.commentId} style={styles.threadBlock}>
              <PostCommentRow
                comment={thread}
                onReply={() =>
                  onReply({
                    commentId: thread.commentId,
                    authorLabel: thread.authorDisplayName?.trim() || t('common.deletedUser'),
                  })
                }
                onToggleLike={() => onToggleCommentLike(thread.commentId, !thread.likedByViewer)}
              />
              {thread.replies.map((reply) => (
                <PostCommentRow
                  key={reply.commentId}
                  comment={reply}
                  nested
                  onToggleLike={() => onToggleCommentLike(reply.commentId, !reply.likedByViewer)}
                />
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  wrap: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.base,
  },
  toolbar: {
    flexDirection: rowDirectionStart,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  heading: {
    ...typography.label,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    flex: 1,
  },
  likeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  likeBtnOn: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  likeBtnPressed: { opacity: 0.9 },
  likeCount: { ...typography.caption, color: colors.textSecondary, ...typography.semiBold },
  likeCountOn: { color: colors.primary },
  spinner: { marginStart: spacing.xs },
  empty: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    marginBottom: spacing.sm,
  },
  threadList: { gap: spacing.md, marginBottom: spacing.sm },
  threadBlock: { gap: spacing.xs },
}));
