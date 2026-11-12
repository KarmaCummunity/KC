// Handled-error reporting: caught errors reach Sentry tagged by source,
// network blips are dropped, and reporting itself never throws.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const captureException = vi.fn();
let sentryReady = true;
vi.mock('../sentry', () => ({ getSentryIfInit: () => (sentryReady ? { captureException } : null) }));

import { isReportableError, reportHandledError } from '../reportHandledError';

describe('reportHandledError', () => {
  beforeEach(() => {
    captureException.mockClear();
    sentryReady = true;
  });

  it('captures a handled error with its source tag and query key', () => {
    reportHandledError(new Error('boom'), 'query', ['feed', 1]);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'boom' }),
      expect.objectContaining({
        level: 'error',
        tags: { boundary: 'handled', source: 'query' },
        extra: { key: '["feed",1]' },
      }),
    );
  });

  it('downgrades a non-retryable (4xx) failure to a warning', () => {
    reportHandledError({ message: 'forbidden', status: 403 }, 'mutation');
    expect(captureException).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('drops network failures', () => {
    reportHandledError(new Error('Network request failed'), 'query');
    expect(captureException).not.toHaveBeenCalled();
    expect(isReportableError(new Error('Failed to fetch'))).toBe(false);
    expect(isReportableError(new Error('null is not an object'))).toBe(true);
  });

  it('is a no-op before Sentry is initialised', () => {
    sentryReady = false;
    expect(() => reportHandledError(new Error('x'), 'manual')).not.toThrow();
    expect(captureException).not.toHaveBeenCalled();
  });

  it('never throws when the SDK itself throws', () => {
    captureException.mockImplementationOnce(() => {
      throw new Error('sdk down');
    });
    expect(() => reportHandledError(new Error('x'), 'manual')).not.toThrow();
  });
});
