// FR-MOD-001 — Report sheet opened from the post-detail ⋮ menu (shared `ReportSheet`).
import React from 'react';
import { useTranslation } from 'react-i18next';
import { container } from '../../lib/container';
import { ReportSheet } from '../report/ReportSheet';

interface Props {
  postId: string;
  visible: boolean;
  onClose: () => void;
}

export function ReportPostModal({ postId, visible, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <ReportSheet
      visible={visible}
      onClose={onClose}
      copy={{
        title: t('post.reportTitle'),
        noteLabel: t('post.reportNotePlaceholder'),
        submitLabel: t('post.reportSubmit'),
        submittingLabel: t('post.reportSubmitting'),
        cancelLabel: t('general.cancel'),
      }}
      noteMaxLength={500}
      fileReport={(reporterId, reason, note) => container.reportPost.execute({ reporterId, postId, reason, note })}
    />
  );
}
