// FR-ADMIN-004 — Ban sheet opened from a user profile by a super admin.
// Shared `ReasonNoteSheet` with a destructive (red) submit; the kit sheet keeps
// the note above the keyboard. Defence-in-depth: self-ban / admin-ban are also
// rejected by the use case + DB.
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { container } from '../../lib/container';
import { useAuthStore } from '../../store/authStore';
import { confirmAndRun, showAdminToast } from '../chat/system/adminActions';
import { ReasonNoteSheet } from '../report/ReasonNoteSheet';

type BanReason = 'spam' | 'harassment' | 'policy_violation' | 'other';

const REASONS: Array<{ value: BanReason; labelKey: string }> = [
  { value: 'spam', labelKey: 'moderation.ban.reasons.spam' },
  { value: 'harassment', labelKey: 'moderation.ban.reasons.harassment' },
  { value: 'policy_violation', labelKey: 'moderation.ban.reasons.policy_violation' },
  { value: 'other', labelKey: 'moderation.ban.reasons.other' },
];

interface Props {
  targetUserId: string;
  visible: boolean;
  onClose: () => void;
}

export function BanUserModal({ targetUserId, visible, onClose }: Props) {
  const { t } = useTranslation();
  const adminId = useAuthStore((s) => s.session?.userId);
  const [reason, setReason] = useState<BanReason>('spam');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Start fresh on the next open.
  useEffect(() => {
    if (!visible) {
      setReason('spam');
      setNote('');
      setSubmitting(false);
    }
  }, [visible]);

  const submit = () => {
    if (!adminId || submitting) return;
    setSubmitting(true);
    confirmAndRun({
      action: 'ban',
      onConfirm: async () => {
        await container.banUser.execute({
          adminId,
          targetUserId,
          reason,
          note: note.trim(),
        });
      },
      onSuccess: () => {
        setSubmitting(false);
        onClose();
        showAdminToast(t('moderation.actions.success.ban'));
      },
      onError: (msg) => {
        setSubmitting(false);
        showAdminToast(msg);
      },
      // TD-251 — backing out of the confirm frees the sheet again.
      onCancel: () => setSubmitting(false),
    });
  };

  return (
    <ReasonNoteSheet
      visible={visible}
      onClose={onClose}
      title={t('moderation.ban.title')}
      reasonLabel={t('moderation.ban.reasonLabel')}
      reasons={REASONS.map((r) => ({ value: r.value, label: t(r.labelKey) }))}
      reason={reason}
      onReasonChange={setReason}
      noteLabel={t('moderation.ban.noteLabel')}
      note={note}
      onNoteChange={setNote}
      noteMaxLength={500}
      submitLabel={t('moderation.ban.submit')}
      submitting={submitting}
      onSubmit={submit}
      cancelLabel={t('moderation.actions.cancel')}
      destructive
    />
  );
}
