// KC#867 — reactions + comments on post detail (native-feeling tap targets).

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { hapticLightTap, hapticSuccess } from '../../lib/haptics';
import { makeUseStyles, spacing, typography, radius, Text } from '@kc/ui';
import { TextField } from '../ui/TextField';
import type { PostReactionType } from '@kc/infrastructure-supabase';
import { container } from '../../lib/container';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

const REACTIONS: PostReactionType[] = ['like', 'support', 'thanks'];

type Props = Readonly<{
  postId: string;
  viewerId: string | null;
}>;

export function PostEngagementSection({ postId, viewerId }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState({ reactionCount: 0, commentCount: 0 });
  const [activeReaction, setActiveReaction] = useState<PostReactionType | null>(null);
  const [comments, setComments] = useState<{ body: string; authorId: string }[]>([]);
  const [draft, setDraft] = useState('');

  const refresh = useCallback(async () => {
    const s = await container.postEngagement.getStats(postId);
    if (s) setStats({ reactionCount: s.reactionCount, commentCount: s.commentCount });
    if (viewerId) {
      const rows = await container.postEngagement.listComments(postId);
      setComments(rows.map((r) => ({ body: r.body, authorId: r.authorId })));
    }
  }, [postId, viewerId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onReaction = async (type: PostReactionType) => {
    if (!viewerId || busy) return;
    hapticLightTap();
    setBusy(true);
    const previous = activeReaction;
    const next = activeReaction === type ? null : type;
    setActiveReaction(next); // optimistic: the chip flips instantly with the haptic
    try {
      await container.postEngagement.setReaction(postId, next);
      await refresh();
    } catch {
      setActiveReaction(previous);
    } finally {
      setBusy(false);
    }
  };

  const onSubmitComment = async () => {
    const body = draft.trim();
    if (!viewerId || !body || busy) return;
    hapticLightTap();
    setBusy(true);
    try {
      await container.postEngagement.createComment(postId, body);
      hapticSuccess();
      setDraft('');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  if (!viewerId) return null;

  return (
    // testID: E2E anchor for the post's likes and comments (Maestro flow 17, G1 step 4a).
    <View style={styles.wrap} testID="post-engagement-section">
      <Text style={styles.heading}>{t('post.engagement.title')}</Text>
      <View style={styles.reactionRow}>
        {REACTIONS.map((r) => {
          const selected = activeReaction === r;
          return (
            <TouchableOpacity
              key={r}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[styles.reactionChip, selected ? styles.reactionChipOn : null]}
              onPress={() => void onReaction(r)}
              disabled={busy}
            >
              <Text style={[styles.reactionLabel, selected ? styles.reactionLabelOn : null]}>
                {t(`post.engagement.reaction.${r}`)}
              </Text>
            </TouchableOpacity>
          );
        })}
        {busy ? <ActivityIndicator size="small" style={styles.spinner} /> : null}
      </View>
      <Text style={styles.meta}>
        {t('post.engagement.meta', { reactions: stats.reactionCount, comments: stats.commentCount })}
      </Text>
      {comments.slice(-5).map((c, i) => (
        <Text key={`${c.authorId}-${i}`} style={styles.commentLine} numberOfLines={3}>
          {c.body}
        </Text>
      ))}
      <TextField
        label={t('post.engagement.commentPlaceholder')}
        value={draft}
        onChangeText={setDraft}
        placeholder={t('post.engagement.commentPlaceholder')}
        multiline
        maxLength={2000}
      />
      <TouchableOpacity
        style={[styles.sendBtn, draft.trim().length === 0 ? styles.sendBtnDisabled : null]}
        onPress={() => void onSubmitComment()}
        disabled={draft.trim().length === 0 || busy}
      >
        <Text style={styles.sendBtnText}>{t('post.engagement.commentSend')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  wrap: {
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  heading: {
    ...typography.h3,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    marginBottom: spacing.sm,
  },
  reactionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' },
  reactionChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.background,
  },
  reactionChipOn: { backgroundColor: colors.primaryLight },
  reactionLabel: { ...typography.caption, color: colors.textSecondary },
  reactionLabelOn: { color: colors.primary, ...typography.semiBold },
  spinner: { marginStart: spacing.xs },
  meta: { ...typography.caption, color: colors.textSecondary, marginVertical: spacing.sm, textAlign: rtlTextAlignStart },
  commentLine: { ...typography.body, color: colors.textPrimary, marginBottom: spacing.xs, textAlign: rtlTextAlignStart },
  sendBtn: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  sendBtnDisabled: { opacity: 0.45 },
  sendBtnText: { ...typography.body, color: colors.textInverse, ...typography.semiBold },
}));
