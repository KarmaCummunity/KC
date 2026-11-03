// Report flow shared by ReportPostModal, ReportChatModal, ReportListingModal and
// ReportUserModal: the `useReportForm` state + submit pipeline, the
// `ReasonNoteSheet` UI and the `NotifyModal` outcome. Each modal only supplies
// its copy and the use case that files the report.
import React from 'react';
import type { ReportReason } from '@kc/domain';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../store/authStore';
import { NotifyModal } from '../NotifyModal';
import { ReasonNoteSheet } from './ReasonNoteSheet';
import { postNamespaceReportMessages, useReportForm, type ReportOutcomeMessages } from './useReportForm';

/** A report reason and the i18n key of its label. */
export interface ReportReasonKey {
  readonly value: ReportReason;
  readonly key: string;
}

/** Reasons offered by the post, chat and listing reports (`post.*` labels). */
const POST_REPORT_REASON_KEYS: readonly ReportReasonKey[] = [
  { value: 'Spam', key: 'post.reportReasonSpam' },
  { value: 'Offensive', key: 'post.reportReasonOffensive' },
  { value: 'Misleading', key: 'post.reportReasonMisleading' },
  { value: 'Illegal', key: 'post.reportReasonIllegal' },
  { value: 'Other', key: 'post.reportReasonOther' },
];

/** Translated copy of one report sheet. */
export interface ReportSheetCopy {
  readonly title: string;
  readonly reasonLabel?: string;
  readonly noteLabel: string;
  readonly submitLabel: string;
  /** Submit text while sending; without it the button shows a spinner. */
  readonly submittingLabel?: string;
  readonly cancelLabel: string;
}

/** Files one report for the signed-in user; `note` is undefined when left empty. */
export type FileReport = (reporterId: string, reason: ReportReason, note: string | undefined) => Promise<void>;

interface Props {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly copy: ReportSheetCopy;
  /** Defaults to {@link POST_REPORT_REASON_KEYS}. */
  readonly reasonKeys?: readonly ReportReasonKey[];
  readonly noteMaxLength?: number;
  /** Outcome notices; defaults to the `post.*` copy (`postNamespaceReportMessages`). */
  readonly messages?: ReportOutcomeMessages;
  readonly fileReport: FileReport;
}

/** Report bottom sheet plus its outcome notice. Does nothing on submit while signed out. */
export function ReportSheet({
  visible,
  onClose,
  copy,
  reasonKeys = POST_REPORT_REASON_KEYS,
  noteMaxLength,
  messages,
  fileReport,
}: Props) {
  const { t } = useTranslation();
  const userId = useAuthStore((s) => s.session?.userId);
  const { reason, setReason, note, setNote, submitting, notify, setNotify, runSubmit } = useReportForm(visible);

  const submit = () => {
    if (!userId) return;
    void runSubmit((r, n) => fileReport(userId, r, n || undefined), onClose, messages ?? postNamespaceReportMessages(t));
  };

  return (
    <>
      <ReasonNoteSheet
        visible={visible}
        onClose={onClose}
        title={copy.title}
        reasonLabel={copy.reasonLabel}
        reasons={reasonKeys.map(({ value, key }) => ({ value, label: t(key) }))}
        reason={reason}
        onReasonChange={setReason}
        noteLabel={copy.noteLabel}
        note={note}
        onNoteChange={setNote}
        noteMaxLength={noteMaxLength}
        submitLabel={copy.submitLabel}
        submittingLabel={copy.submittingLabel}
        submitting={submitting}
        onSubmit={submit}
        cancelLabel={copy.cancelLabel}
      />
      <NotifyModal
        visible={notify !== null}
        title={notify?.title ?? ''}
        message={notify?.message ?? ''}
        onDismiss={() => setNotify(null)}
      />
    </>
  );
}
