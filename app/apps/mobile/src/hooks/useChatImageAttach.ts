// Chat composer image attach (FR-CHAT media) with a 5.1.1(iv) blocked-permission note.
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../store/chatStore';
import { container } from '../lib/container';
import { isBlockedMediaPick, type MediaPermissionKind } from '../lib/mediaPermissionTypes';
import { pickChatImage, uploadChatImageAndSend } from '../services/chatMediaUpload';

interface Args {
  readonly chatId: string;
  readonly userId: string;
  readonly onError: (notice: { title: string; message: string }) => void;
}

export function useChatImageAttach({ chatId, userId, onError }: Args) {
  const { t } = useTranslation();
  const [permissionBlocked, setPermissionBlocked] = useState<MediaPermissionKind | null>(null);

  const attach = useCallback(async () => {
    const picked = await pickChatImage();
    if (isBlockedMediaPick(picked)) {
      setPermissionBlocked(picked.kind);
      return;
    }
    setPermissionBlocked(null);
    if (picked.status !== 'ok') return;
    try {
      await uploadChatImageAndSend(chatId, userId, picked.value, async (payload) => {
        const server = await container.chatV2Repo.sendMediaMessage(chatId, payload);
        useChatStore.getState().appendOptimistic(chatId, {
          ...server,
          clientId: server.messageId,
        });
      });
    } catch {
      onError({ title: t('chat.errorTitle'), message: t('chat.mediaUploadFailed') });
    }
  }, [chatId, onError, t, userId]);

  return { attach, permissionBlocked };
}
