// FR-POST-013 AC3 — owner-facing Republish CTA shown on the edit-post screen
// when the post has expired. Confirms with a modal, then calls
// rpc_republish_post via getRepublishPostUseCase() and routes to the new post.

import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { colors, radius, spacing, typography, Text, iconSize } from '@kc/ui';
import { isPostError, type PostErrorCode } from '@kc/application';
import { getRepublishPostUseCase } from '../../services/postsComposition';
import { ConfirmActionModal } from './ConfirmActionModal';

export interface ExpiredRepublishViewProps {
  postId: string;
  viewerId: string;
  onRepublished: (newPostId: string) => void;
}

const ERROR_KEY: Record<PostErrorCode, string | undefined> = {
  active_post_limit_exceeded: 'post.editPost.republishErrorLimit',
  followers_only_requires_private: 'post.editPost.republishErrorFollowers',
  republish_not_owner: 'post.editPost.republishErrorOwner',
  republish_wrong_status: 'post.editPost.republishErrorStatus',
  republish_not_found: 'post.editPost.republishErrorStatus',
  title_required: undefined,
  title_too_long: undefined,
  description_too_long: undefined,
  address_required: undefined,
  address_invalid: undefined,
  street_number_invalid: undefined,
  city_not_found: undefined,
  image_required_for_give: undefined,
  too_many_media_assets: undefined,
  condition_required_for_give: undefined,
  urgency_only_for_request: undefined,
  condition_only_for_give: undefined,
  visibility_downgrade_forbidden: undefined,
  invalid_post_type: undefined,
  invalid_visibility: undefined,
  invalid_category: undefined,
  invalid_location_display_level: undefined,
  not_found: undefined,
  forbidden: undefined,
  closure_not_owner: undefined,
  closure_wrong_status: undefined,
  closure_recipient_not_in_chat: undefined,
  reopen_window_expired: undefined,
  post_not_open: undefined,
  post_owner_delete_forbidden: undefined,
  unknown: undefined,
};

export function ExpiredRepublishView({ postId, viewerId, onRepublished }: ExpiredRepublishViewProps) {
  const { t } = useTranslation();
  const [confirmVisible, setConfirmVisible] = useState(false);

  const republish = useMutation({
    mutationFn: () => getRepublishPostUseCase().execute({ postId, ownerId: viewerId }),
    onSuccess: ({ newPostId }) => {
      setConfirmVisible(false);
      onRepublished(newPostId);
    },
  });

  const errorMessage = (() => {
    if (!republish.error) return null;
    if (isPostError(republish.error)) {
      const key = ERROR_KEY[republish.error.code];
      if (key) return t(key);
    }
    return t('post.editPost.republishErrorGeneric');
  })();

  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        <Ionicons
          name="time-outline"
          size={56} // brand-guard-allow: empty-state hero glyph, above the icon scale
          color={colors.textSecondary}
        />
      </View>
      <Text style={styles.title}>{t('post.editPost.notEditableTitle')}</Text>
      <Text style={styles.body}>{t('post.editPost.notEditableExpired')}</Text>
      <TouchableOpacity
        style={styles.cta}
        onPress={() => setConfirmVisible(true)}
        accessibilityRole="button"
        accessibilityLabel={t('post.editPost.republishCta')}
      >
        <Ionicons name="refresh-outline" size={iconSize.md} color={colors.surface} />
        <Text style={styles.ctaText}>{t('post.editPost.republishCta')}</Text>
      </TouchableOpacity>

      <ConfirmActionModal
        visible={confirmVisible}
        title={t('post.editPost.republishConfirmTitle')}
        message={t('post.editPost.republishConfirmBody')}
        confirmLabel={t('post.editPost.republishConfirmAccept')}
        cancelLabel={t('post.editPost.republishConfirmCancel')}
        isBusy={republish.isPending}
        errorMessage={errorMessage}
        onCancel={() => {
          if (republish.isPending) return;
          republish.reset();
          setConfirmVisible(false);
        }}
        onConfirm={() => {
          republish.mutate();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.lg,
  },
  iconWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  title: { ...typography.h3, color: colors.textPrimary, textAlign: 'center' },
  body: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    minWidth: 200,
  },
  ctaText: { ...typography.button, color: colors.surface },
});
