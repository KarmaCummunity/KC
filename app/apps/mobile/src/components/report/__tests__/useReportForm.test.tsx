// @vitest-environment jsdom
// #2061 — every ReportError code reaches the user as its own outcome, and an unmapped
// failure is reported to Sentry with its code instead of vanishing behind the generic notice.
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportError, type ReportErrorCode } from '@kc/application';

const sentry = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock('../../../lib/observability/sentry', () => ({ getSentryIfInit: () => sentry }));

import { postNamespaceReportMessages, useReportForm } from '../useReportForm';

// Echo the key so each outcome is identifiable without the locale files.
const messages = postNamespaceReportMessages((key) => key);

async function submitWith(error: unknown) {
  const onClose = vi.fn();
  const { result } = renderHook(() => useReportForm(true));
  await act(async () => {
    await result.current.runSubmit(() => Promise.reject(error), onClose, messages);
  });
  return { notify: result.current.notify, onClose };
}

describe('useReportForm.runSubmit', () => {
  beforeEach(() => sentry.captureException.mockClear());

  it.each<[ReportErrorCode, string, boolean]>([
    ['duplicate_within_24h', 'post.reportDuplicateBody', true],
    ['target_already_moderated', 'post.reportAlreadyModeratedBody', true],
    ['invalid_target', 'post.reportInvalidTargetBody', true],
    ['cannot_report_self', 'post.reportSelfBody', true],
    ['rate_limited', 'post.reportRateLimitedBody', false],
  ])('shows the %s outcome', async (code, body, closesSheet) => {
    const { notify, onClose } = await submitWith(new ReportError(code, 'server said no'));
    expect(notify?.message).toBe(body);
    expect(onClose).toHaveBeenCalledTimes(closesSheet ? 1 : 0);
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('keeps the sheet open and reports an unmapped failure to Sentry with its code', async () => {
    const cause = { code: '42501', message: 'permission denied for table reports' };
    const { notify, onClose } = await submitWith(new ReportError('unknown', cause.message, cause));
    expect(notify?.message).toBe('post.reportErrorBody');
    expect(onClose).not.toHaveBeenCalled();
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.any(ReportError),
      expect.objectContaining({ tags: expect.objectContaining({ area: 'report', report_error_code: 'unknown' }) }),
    );
  });
});
