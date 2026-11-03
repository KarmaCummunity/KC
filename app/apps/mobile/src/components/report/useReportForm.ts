// Shared state + submit pipeline for the report-sheet family
// (ReportPostModal / ReportChatModal / ReportListingModal / ReportUserModal),
// consumed by `ReportSheet`: reason radio + optional note + a submit that maps
// ReportError codes to a NotifyModal outcome. Centralising the state, the
// reset-on-close effect, and the error→outcome mapping here keeps the report
// modals as thin wrappers that only supply copy and the use case.
import { useEffect, useState } from 'react';
import type { ReportReason } from '@kc/domain';
import { ReportError } from '@kc/application';

export interface ReportOutcome {
  readonly title: string;
  readonly message: string;
}

export interface ReportOutcomeMessages {
  readonly success: ReportOutcome;
  readonly duplicate: ReportOutcome;
  readonly alreadyModerated: ReportOutcome;
  readonly error: ReportOutcome;
}

/** A single report action — receives the chosen reason and the trimmed note. */
export type PerformReport = (reason: ReportReason, note: string) => Promise<void>;

/**
 * Outcome copy for the reports that resolve everything from the `post.*` /
 * `general.*` namespaces (post, chat, listing) — `ReportSheet`'s default.
 * ReportChatModal overrides only `duplicate.message`.
 */
export function postNamespaceReportMessages(t: (key: string) => string): ReportOutcomeMessages {
  return {
    success: { title: t('post.reportSuccessTitle'), message: t('post.reportSuccessBody') },
    duplicate: { title: t('post.reportDuplicateTitle'), message: t('post.reportDuplicateBody') },
    alreadyModerated: {
      title: t('post.reportAlreadyModeratedTitle'),
      message: t('post.reportAlreadyModeratedBody'),
    },
    error: { title: t('general.error'), message: t('post.reportErrorBody') },
  };
}

export function useReportForm(visible: boolean) {
  const [reason, setReason] = useState<ReportReason>('Spam');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // TD-138: Alert.alert is a no-op on react-native-web — outcomes surface via NotifyModal.
  const [notify, setNotify] = useState<ReportOutcome | null>(null);

  // Reset to defaults when the modal closes so the next open starts fresh
  // (otherwise reason/note persist across openings on the same mounted instance).
  useEffect(() => {
    if (!visible) {
      setReason('Spam');
      setNote('');
      setSubmitting(false);
    }
  }, [visible]);

  const runSubmit = async (
    perform: PerformReport,
    onClose: () => void,
    messages: ReportOutcomeMessages,
  ) => {
    setSubmitting(true);
    try {
      await perform(reason, note.trim());
      onClose();
      setNotify(messages.success);
    } catch (err) {
      if (err instanceof ReportError && err.code === 'duplicate_within_24h') {
        onClose();
        setNotify(messages.duplicate);
      } else if (err instanceof ReportError && err.code === 'target_already_moderated') {
        onClose();
        setNotify(messages.alreadyModerated);
      } else {
        setNotify(messages.error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return { reason, setReason, note, setNote, submitting, notify, setNotify, runSubmit } as const;
}
