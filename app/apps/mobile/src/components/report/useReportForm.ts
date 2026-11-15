// Shared state + submit pipeline for the report-sheet family
// (ReportPostModal / ReportChatModal / ReportListingModal / ReportUserModal),
// consumed by `ReportSheet`: reason radio + optional note + a submit that maps
// ReportError codes to a NotifyModal outcome. Centralising the state, the
// reset-on-close effect, and the error→outcome mapping here keeps the report
// modals as thin wrappers that only supply copy and the use case.
import { useEffect, useState } from 'react';
import type { ReportReason } from '@kc/domain';
import { ReportError } from '@kc/application';
import { isBackendUnavailable, notAvailableMessage } from '../../lib/backendAvailability';
import { getSentryIfInit } from '../../lib/observability/sentry';

export interface ReportOutcome {
  readonly title: string;
  readonly message: string;
}

export interface ReportOutcomeMessages {
  readonly success: ReportOutcome;
  readonly duplicate: ReportOutcome;
  readonly alreadyModerated: ReportOutcome;
  readonly error: ReportOutcome;
  // Server-side rejections (#2061). Optional so a sheet with its own copy keeps working; a code
  // without copy falls back to `error`.
  readonly invalidTarget?: ReportOutcome;
  readonly cannotReportSelf?: ReportOutcome;
  readonly rateLimited?: ReportOutcome;
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
    invalidTarget: { title: t('post.reportInvalidTargetTitle'), message: t('post.reportInvalidTargetBody') },
    cannotReportSelf: { title: t('post.reportSelfTitle'), message: t('post.reportSelfBody') },
    rateLimited: { title: t('post.reportRateLimitedTitle'), message: t('post.reportRateLimitedBody') },
  };
}

/**
 * Sends a failure no outcome covers to Sentry, tagged with its code, so the next occurrence
 * names its cause (#2061). Never throws: observability must not break the report flow.
 */
function reportUnmappedFailure(err: unknown): void {
  try {
    getSentryIfInit()?.captureException(err, {
      tags: { area: 'report', report_error_code: err instanceof ReportError ? err.code : 'non_report_error' },
      extra: { cause: err instanceof ReportError ? err.cause : undefined },
    });
  } catch {
    /* swallow: see above */
  }
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
      } else if (isBackendUnavailable(err)) {
        // Degrade rule: the reports table is not deployed yet.
        setNotify({ title: messages.error.title, message: notAvailableMessage() });
      } else if (err instanceof ReportError && err.code === 'invalid_target') {
        // The item is gone or no longer visible to the reporter: nothing left to retry.
        onClose();
        setNotify(messages.invalidTarget ?? messages.error);
      } else if (err instanceof ReportError && err.code === 'cannot_report_self') {
        onClose();
        setNotify(messages.cannotReportSelf ?? messages.error);
      } else if (err instanceof ReportError && err.code === 'rate_limited') {
        // Keep the sheet open: the note is kept and the user can retry once the cap resets.
        setNotify(messages.rateLimited ?? messages.error);
      } else {
        reportUnmappedFailure(err);
        setNotify(messages.error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return { reason, setReason, note, setNote, submitting, notify, setNotify, runSubmit } as const;
}
