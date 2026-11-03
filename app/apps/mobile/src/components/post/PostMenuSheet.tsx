// FR-POST-014 AC4 + FR-POST-015 AC1 + FR-ADMIN-006 + FR-ADMIN-009.
// Bottom-sheet menu opened from PostMenuButton on PostDetail.
// The frame, dismissal and motion come from the kit `BottomSheet` (spec 17 §4.1).
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { container } from '../../lib/container';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { PostWithOwner } from '@kc/application';
import { makeUseStyles, spacing } from '@kc/ui';
import { BottomSheet } from '../ui/BottomSheet';
import { SheetActionRow } from '../ui/SheetActionRow';
import { ConfirmActionModal } from './ConfirmActionModal';
import { ReportPostModal } from './ReportPostModal';
import { usePostMenuActions } from '../../hooks/usePostMenuActions';
import { usePostShare } from '../../hooks/usePostShare';
import { shouldShowPostExposureControls } from '../../hooks/usePostActorPrivacyModel';
import { PostMenuExposureBlock } from './PostMenuExposureBlock';
import { runAfterBottomSheetDismiss } from '../../lib/runAfterBottomSheetDismiss';
import { hapticLightTap } from '../../lib/haptics';
import { useFeedSessionStore } from '../../store/feedSessionStore';

interface Props {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly post: PostWithOwner;
  /** When false, share row is omitted (e.g. post detail has a header share button). */
  readonly showShareInMenu?: boolean;
  readonly viewerId: string | null;
  readonly isSuperAdmin: boolean;
  readonly isSaved: boolean;
  readonly saveBusy: boolean;
  readonly onToggleSave: () => void;
  readonly onAfterRemoval: () => void;
  readonly onEdit: () => void;
}

type ActiveModal = null | 'delete-owner' | 'admin-remove' | 'report';

export function PostMenuSheet({
  visible,
  onClose,
  post,
  showShareInMenu = true,
  viewerId,
  isSuperAdmin,
  isSaved,
  saveBusy,
  onToggleSave,
  onAfterRemoval,
  onEdit,
}: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const showToast = useFeedSessionStore((st) => st.showEphemeralToast);
  const styles = usePostMenuSheetStyles();
  const [active, setActive] = useState<ActiveModal>(null);
  const { busy, error, clearError, handleOwnerDelete, handleAdminRemove } =
    usePostMenuActions({ post, onAfterRemoval, onSettle: () => setActive(null) });
  const { canShare, share, busy: shareBusy } = usePostShare(post);

  const isOwner = viewerId !== null && post.ownerId === viewerId;
  const canEditPost = (isOwner || isSuperAdmin) && post.status === 'open';
  const showExposureBlock = viewerId !== null && shouldShowPostExposureControls(viewerId, post);

  function openModal(name: Exclude<ActiveModal, null>) {
    clearError();
    onClose();
    setActive(name);
  }

  function closeModal() {
    if (busy) return;
    setActive(null);
    clearError();
  }

  return (
    <>
      <BottomSheet visible={visible} onDismiss={onClose}>
        <View style={[styles.actionsGroup, showExposureBlock && styles.actionsGroupBordered]}>
          {showShareInMenu && canShare ? (
            <SheetActionRow
              icon="share-outline"
              label={t('post.menuShare')}
              disabled={shareBusy}
              onPress={() => {
                if (shareBusy) return;
                onClose();
                runAfterBottomSheetDismiss(() => share());
              }}
            />
          ) : null}
          {!isOwner ? (
            <SheetActionRow
              icon="eye-off-outline"
              label={t('post.menuHideFromFeed')}
              onPress={() => {
                onClose();
                void container.socialFeed.hidePost(post.postId).then(() => {
                  void queryClient.invalidateQueries({ queryKey: ['feed'] });
                });
              }}
            />
          ) : null}
          {!isOwner && viewerId ? (
            <SheetActionRow
              icon="volume-mute-outline"
              label={t('feedSettings.menuMuteUser')}
              onPress={() => {
                onClose();
                hapticLightTap();
                void container.socialFeed.addMuteFilter('user', post.ownerId).then(() => {
                  showToast(t('feedSettings.mutedUserToast'), 'success', 2200);
                  for (const key of ['feed', 'feed-mute-filters']) void queryClient.invalidateQueries({ queryKey: [key] });
                });
              }}
            />
          ) : null}
          {isOwner ? null : (
            <SheetActionRow
              icon="flag-outline"
              label={t('post.report')}
              destructive
              onPress={() => openModal('report')}
            />
          )}
          <SheetActionRow
            icon={isSaved ? 'bookmark' : 'bookmark-outline'}
            label={isSaved ? t('post.menuUnsave') : t('post.menuSave')}
            disabled={saveBusy}
            onPress={() => {
              if (saveBusy) return;
              onToggleSave();
              onClose();
            }}
          />
          {canEditPost ? (
            <SheetActionRow
              icon="create-outline"
              label={t('post.menuEdit')}
              onPress={() => {
                onClose();
                onEdit();
              }}
            />
          ) : null}
          {isOwner ? (
            <SheetActionRow
              icon="trash-outline"
              label={t('post.menuDelete')}
              destructive
              onPress={() => openModal('delete-owner')}
            />
          ) : null}
          {isSuperAdmin ? (
            <SheetActionRow
              icon="shield-outline"
              label={t('post.menuAdminRemove')}
              destructive
              onPress={() => openModal('admin-remove')}
            />
          ) : null}
        </View>

        {showExposureBlock && viewerId ? (
          <PostMenuExposureBlock post={post} viewerId={viewerId} />
        ) : null}
      </BottomSheet>

      <ConfirmActionModal
        visible={active === 'delete-owner'}
        title={t('post.deleteConfirmTitle')}
        message={t('post.deleteConfirmBody')}
        confirmLabel={t('post.delete')}
        destructive
        isBusy={busy}
        errorMessage={error}
        onCancel={closeModal}
        onConfirm={handleOwnerDelete}
      />

      <ConfirmActionModal
        visible={active === 'admin-remove'}
        title={t('post.adminRemoveTitle')}
        message={t('post.adminRemoveBody', { title: post.title })}
        confirmLabel={t('post.adminRemoveCta')}
        destructive
        isBusy={busy}
        errorMessage={error}
        onCancel={closeModal}
        onConfirm={handleAdminRemove}
      />

      <ReportPostModal postId={post.postId} visible={active === 'report'} onClose={closeModal} />
    </>
  );
}

const usePostMenuSheetStyles = makeUseStyles(({ colors }) => ({
  actionsGroup: {
    paddingTop: spacing.xs,
  },
  actionsGroupBordered: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
}));
