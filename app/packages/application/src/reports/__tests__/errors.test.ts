import { describe, it, expect } from 'vitest';
import { ReportError } from '../errors';

describe('ReportError', () => {
  it('is an Error subclass with name="ReportError" and carries code/message/cause', () => {
    const cause = new Error('inner');
    const err = new ReportError('duplicate_within_24h', 'already reported', cause);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ReportError);
    expect(err.name).toBe('ReportError');
    expect(err.code).toBe('duplicate_within_24h');
    expect(err.message).toBe('already reported');
    expect(err.cause).toBe(cause);
  });

  it('cause defaults to undefined', () => {
    expect(new ReportError('invalid_target', 'x').cause).toBeUndefined();
  });

  it('preserves every code in the ReportErrorCode union (small, exhaustive)', () => {
    for (const code of [
      'invalid_target',
      'duplicate_within_24h',
      'target_already_moderated',
      'cannot_report_self',
      'rate_limited',
      'unknown',
    ] as const) {
      expect(new ReportError(code, code).code).toBe(code);
    }
  });

  it('setPrototypeOf preserves instanceof across transpilation', () => {
    const err = new ReportError('unknown', 'x');
    expect(err instanceof ReportError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});
