// @vitest-environment jsdom
// #2096 (FR-MOD-002): the report-a-problem submit — one submission per tap burst, the
// support thread opens on success, and a failure explains itself without losing the text.
import { act, renderHook } from '@testing-library/react';
import { ChatError } from '@kc/application';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../lib/container', () => ({ container: { submitSupportIssue: { execute } } }));

import { useReportIssueSubmit } from '../useReportIssueSubmit';

/** A promise the test resolves by hand, to hold a submission in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const VALID = 'the feed does not load';

afterEach(() => vi.clearAllMocks());

describe('useReportIssueSubmit', () => {
  it('submits the trimmed description once and opens the support thread', async () => {
    execute.mockResolvedValue({ chatId: 'c_support' });
    const onSubmitted = vi.fn();
    const { result } = renderHook(() => useReportIssueSubmit(onSubmitted));

    await act(() => result.current.submit('Bug', `  ${VALID}  `));

    expect(execute).toHaveBeenCalledWith({ category: 'Bug', description: VALID });
    expect(onSubmitted).toHaveBeenCalledWith('c_support');
    expect(result.current.busy).toBe(false);
  });

  it('ignores a second tap while the first submission is in flight (no duplicate report)', async () => {
    const pending = deferred<{ chatId: string }>();
    execute.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useReportIssueSubmit(vi.fn()));

    // Two taps in the same frame: React has not re-rendered `busy` between them.
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.submit(null, VALID);
      second = result.current.submit(null, VALID);
    });
    await act(async () => {
      pending.resolve({ chatId: 'c_support' });
      await Promise.all([first, second]);
    });

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not submit a description under the minimum', async () => {
    const { result } = renderHook(() => useReportIssueSubmit(vi.fn()));
    await act(() => result.current.submit('Bug', '   short   '));
    expect(execute).not.toHaveBeenCalled();
  });

  it('shows the generic error on a network failure and allows another try', async () => {
    execute.mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValueOnce({ chatId: 'c_support' });
    const onSubmitted = vi.fn();
    const { result } = renderHook(() => useReportIssueSubmit(onSubmitted));

    await act(() => result.current.submit(null, VALID));
    expect(result.current.notify).toEqual({
      title: 'settings.reportIssueErrorTitle',
      message: 'settings.reportIssueScreen.errorGeneric',
    });
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);

    act(() => result.current.dismissNotify());
    expect(result.current.notify).toBeNull();
    await act(() => result.current.submit(null, VALID));
    expect(onSubmitted).toHaveBeenCalledWith('c_support');
  });

  it.each([
    ['super_admin_not_found', 'settings.reportIssueScreen.errorAdminNotFound'],
    ['description_too_long', 'settings.reportIssueScreen.errorTooLong'],
  ] as const)('explains a %s refusal with its own message', async (code, message) => {
    execute.mockRejectedValue(new ChatError(code, code));
    const { result } = renderHook(() => useReportIssueSubmit(vi.fn()));
    await act(() => result.current.submit(null, VALID));
    expect(result.current.notify?.message).toBe(message);
  });
});
