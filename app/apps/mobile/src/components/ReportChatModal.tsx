// FR-CHAT-010 — Report sheet opened from the chat ⋮ menu (shared `ReportSheet`).
import React from 'react';
import { useTranslation } from 'react-i18next';
import { container } from '../lib/container';
import { ReportSheet } from './report/ReportSheet';
import { postNamespaceReportMessages } from './report/useReportForm';

interface Props {
  chatId: string;
  visible: boolean;
  onClose: () => void;
}

export function ReportChatModal({ chatId, visible, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <ReportSheet
      visible={visible}
      onClose={onClose}
      copy={{
        title: t('chat.reportChatTitle'),
        noteLabel: t('chat.reportChatNotePlaceholder'),
        submitLabel: t('post.reportSubmit'),
        submittingLabel: t('chat.reportChatSubmitting'),
        cancelLabel: t('general.cancel'),
      }}
      noteMaxLength={500}
      messages={{
        ...postNamespaceReportMessages(t),
        duplicate: { title: t('post.reportDuplicateTitle'), message: t('chat.reportChatDuplicateBody') },
      }}
      fileReport={(reporterId, reason, note) => container.reportChat.execute({ reporterId, chatId, reason, note })}
    />
  );
}
