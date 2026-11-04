// Chat conversation modals/menus — FR-CHAT-002, FR-CHAT-016 (keeps `chat/[id].tsx` under LOC cap).
import React from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useUserBlock } from '../../hooks/useUserBlock';
import { ReportChatModal } from '../ReportChatModal';
import { ChatActionMenu } from '../ChatActionMenu';
import { HideChatConfirmModal } from '../HideChatConfirmModal';

interface Props {
  readonly chatId: string;
  readonly isSupportThread?: boolean;
  readonly reportOpen: boolean;
  readonly onReportClose: () => void;
  readonly menuOpen: boolean;
  readonly onMenuClose: () => void;
  readonly onReportFromMenu: () => void;
  readonly hideConfirmOpen: boolean;
  readonly hideBusy: boolean;
  readonly onHideCancel: () => void;
  readonly onOpenHideConfirm: () => void;
  readonly onHideConfirm: () => Promise<void>;
  /** The other participant; null when deleted. Enables "block" in the menu (FR-MOD-003 AC1). */
  readonly counterpartUserId?: string | null;
}

export function ChatScreenOverlays({
  chatId,
  isSupportThread,
  reportOpen,
  onReportClose,
  menuOpen,
  onMenuClose,
  onReportFromMenu,
  hideConfirmOpen,
  hideBusy,
  onHideCancel,
  onOpenHideConfirm,
  onHideConfirm,
  counterpartUserId,
}: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  // The support thread is never blocked; a deleted counterpart has no one to block.
  const block = useUserBlock(isSupportThread ? '' : (counterpartUserId ?? ''));
  // A blocked pair's chat is hidden from both (FR-MOD-009), so leave it once the block lands.
  const blockFromMenu = () => {
    void block.toggle().then((changed) => {
      if (changed && router.canGoBack()) router.back();
    });
  };
  return (
    <>
      <ReportChatModal chatId={chatId} visible={reportOpen} onClose={onReportClose} />
      <ChatActionMenu
        visible={menuOpen}
        onClose={onMenuClose}
        onReport={onReportFromMenu}
        blockLabel={block.canBlock && !block.isBlocked ? t('moderation.block.block') : undefined}
        onBlock={block.canBlock && !block.isBlocked ? blockFromMenu : undefined}
        deleteLabel={isSupportThread ? undefined : t('chat.menuDeleteFromInbox')}
        onDeleteFromInbox={
          isSupportThread
            ? undefined
            : () => {
                onMenuClose();
                onOpenHideConfirm();
              }
        }
      />
      <HideChatConfirmModal
        visible={hideConfirmOpen}
        loading={hideBusy}
        onCancel={onHideCancel}
        onConfirm={onHideConfirm}
      />
    </>
  );
}
