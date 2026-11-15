// FR-MOD-002 / FR-CHAT-007 AC3 (#2096): submit a support issue from the report-a-problem screen.
//
// Owns the submit state only; the form keeps the category and the text, so a failed
// submission leaves both in place for another try.
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatError, SUPPORT_ISSUE_DESCRIPTION_MIN, type ChatErrorCode } from '@kc/application';
import { container } from '../lib/container';

/** A dialog message shown after a failed submission. */
export interface ReportIssueNotice {
  readonly title: string;
  readonly message: string;
}

/** Refusals with their own explanation; anything else (network, server) gets the generic one. */
const ERROR_MESSAGE_KEYS: Partial<Record<ChatErrorCode, string>> = {
  super_admin_not_found: 'settings.reportIssueScreen.errorAdminNotFound',
  description_too_long: 'settings.reportIssueScreen.errorTooLong',
};

/**
 * Submits a report and calls `onSubmitted` with the support thread's id.
 * `submit` is a no-op below the minimum length and while a submission is in flight: the
 * in-flight flag is a ref, so a second tap in the same frame, before React re-renders the
 * disabled button, still cannot file a duplicate report.
 */
export function useReportIssueSubmit(onSubmitted: (chatId: string) => void) {
  const { t } = useTranslation();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [notify, setNotify] = useState<ReportIssueNotice | null>(null);

  const submit = useCallback(
    async (category: string | null, description: string): Promise<void> => {
      const trimmed = description.trim();
      if (inFlight.current || trimmed.length < SUPPORT_ISSUE_DESCRIPTION_MIN) return;
      inFlight.current = true;
      setBusy(true);
      try {
        const chat = await container.submitSupportIssue.execute({ category, description: trimmed });
        onSubmitted(chat.chatId);
      } catch (err) {
        const key = (err instanceof ChatError && ERROR_MESSAGE_KEYS[err.code]) || 'settings.reportIssueScreen.errorGeneric';
        setNotify({ title: t('settings.reportIssueErrorTitle'), message: t(key) });
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [onSubmitted, t],
  );

  const dismissNotify = useCallback(() => setNotify(null), []);

  return { busy, notify, submit, dismissNotify };
}
