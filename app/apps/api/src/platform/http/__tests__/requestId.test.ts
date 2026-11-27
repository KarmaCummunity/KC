import { describe, expect, it } from 'vitest';
import { resolveRequestId } from '../requestId';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it('keeps a well-formed caller id', () => {
    expect(resolveRequestId('trace-1234.abcd_EF')).toBe('trace-1234.abcd_EF');
  });

  it('generates a fresh id when the caller sent none', () => {
    const first = resolveRequestId(undefined);

    expect(first).toMatch(UUID);
    expect(resolveRequestId(undefined)).not.toBe(first);
  });

  it.each([
    ['too short', 'abc'],
    ['too long', 'a'.repeat(129)],
    ['contains a space', 'has a space in it'],
    ['contains a line break', 'line\nbreak-0000'],
  ])('replaces a caller id that %s', (_reason, value) => {
    expect(resolveRequestId(value)).toMatch(UUID);
  });

  it('replaces a repeated header', () => {
    expect(resolveRequestId(['first-id-0000', 'second-id-0000'])).toMatch(UUID);
  });
});
