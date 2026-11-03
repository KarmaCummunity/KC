// FR-MOD-007 — Report sheet opened from a user profile's overflow menu.
// Shared `ReportSheet`, submitting to container.reportUser (target_type='user').
import React from 'react';
import { useTranslation } from 'react-i18next';
import { container } from '../../lib/container';
import { ReportSheet, type ReportReasonKey } from '../report/ReportSheet';

const USER_REPORT_REASON_KEYS: readonly ReportReasonKey[] = [
  { value: 'Spam', key: 'moderation.reasons.spam' },
  { value: 'Offensive', key: 'moderation.reasons.offensive' },
  { value: 'Misleading', key: 'moderation.reasons.misleading' },
  { value: 'Illegal', key: 'moderation.reasons.illegal' },
  { value: 'Other', key: 'moderation.reasons.other' },
];

interface Props {
  targetUserId: string;
  visible: boolean;
  onClose: () => void;
}

export function ReportUserModal({ targetUserId, visible, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <ReportSheet
      visible={visible}
      onClose={onClose}
      copy={{
        title: t('moderation.report.user.title'),
        reasonLabel: t('moderation.report.user.reasonLabel'),
        noteLabel: t('moderation.report.user.noteLabel'),
        submitLabel: t('moderation.report.user.submit'),
        cancelLabel: t('moderation.actions.cancel'),
      }}
      reasonKeys={USER_REPORT_REASON_KEYS}
      noteMaxLength={500}
      messages={{
        success: { title: t('moderation.report.user.successTitle'), message: t('moderation.report.user.successToast') },
        duplicate: { title: t('moderation.report.user.duplicateTitle'), message: t('moderation.report.user.duplicateError') },
        alreadyModerated: {
          title: t('moderation.report.user.alreadyModeratedTitle'),
          message: t('moderation.report.user.alreadyModeratedError'),
        },
        error: { title: t('moderation.report.user.errorTitle'), message: t('moderation.actions.errors.networkError') },
      }}
      fileReport={(reporterId, reason, note) => container.reportUser.execute({ reporterId, targetUserId, reason, note })}
    />
  );
}
