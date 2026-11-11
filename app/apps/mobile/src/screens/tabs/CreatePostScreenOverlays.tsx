import React from 'react';
import { useTranslation } from 'react-i18next';
import type { PostVisibility } from '@kc/domain';
import { EnablePushModal } from '../../components/EnablePushModal';
import { NotifyModal } from '../../components/NotifyModal';
import { ConfirmActionModal } from '../../components/post/ConfirmActionModal';
import { DraftResumeModal } from '../../components/post/DraftResumeModal';
import { registerCurrentDeviceIfPermitted } from '../../lib/notifications';
import { container } from '../../lib/container';
import type { usePushPermissionGate } from '../../lib/notifications/usePushPermissionGate';

type PushGate = ReturnType<typeof usePushPermissionGate>;

type Props = {
  draftResumeVisible: boolean;
  onDraftContinue: () => void;
  onDraftStartFresh: () => void;
  pushGate: PushGate;
  ownerId: string | undefined;
  notify: { title: string; message: string } | null;
  onNotifyDismiss: () => void;
  publishFollowersOpen: boolean;
  followersCount: number;
  setPublishFollowersOpen: (open: boolean) => void;
  setVisibility: (v: PostVisibility) => void;
  visibilityRef: React.MutableRefObject<PostVisibility>;
  runPublishAfterGate: () => void;
};

export function CreatePostScreenOverlays({
  draftResumeVisible,
  onDraftContinue,
  onDraftStartFresh,
  pushGate,
  ownerId,
  notify,
  onNotifyDismiss,
  publishFollowersOpen,
  followersCount,
  setPublishFollowersOpen,
  setVisibility,
  visibilityRef,
  runPublishAfterGate,
}: Props) {
  const { t } = useTranslation();
  const { modalState, handleAccept, handleDecline } = pushGate;

  return (
    <>
      <DraftResumeModal
        visible={draftResumeVisible}
        onContinue={onDraftContinue}
        onStartFresh={onDraftStartFresh}
      />
      <EnablePushModal
        visible={modalState.visible}
        trigger={modalState.trigger}
        onAccept={async () => {
          const status = await handleAccept();
          if (status === 'granted' && ownerId) {
            await registerCurrentDeviceIfPermitted(ownerId, { deviceRepo: container.deviceRepo });
          }
        }}
        onDecline={handleDecline}
      />
      <NotifyModal
        visible={notify !== null}
        title={notify?.title ?? ''}
        message={notify?.message ?? ''}
        onDismiss={onNotifyDismiss}
      />
      <ConfirmActionModal
        visible={publishFollowersOpen}
        title={t('post.publishFollowersTitle')}
        message={t('post.publishFollowersBody', { count: followersCount })}
        confirmLabel={t('post.publishFollowersConfirmCta')}
        cancelLabel={t('post.publishFollowersMakePublicCta')}
        onCancel={() => {
          setPublishFollowersOpen(false);
          visibilityRef.current = 'Public';
          setVisibility('Public');
          runPublishAfterGate();
        }}
        onConfirm={() => {
          setPublishFollowersOpen(false);
          runPublishAfterGate();
        }}
      />
    </>
  );
}
