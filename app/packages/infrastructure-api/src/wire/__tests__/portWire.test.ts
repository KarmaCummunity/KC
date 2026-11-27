import { describe, expect, it } from 'vitest';
import { decodeArgs, encodeArgs, markDates, portCallPath, reviveDates } from '../portWire';

describe('port wire', () => {
  it('builds the path of a call', () => {
    expect(portCallPath('users', 'getFollowers')).toBe('/v1/ports/users/getFollowers');
  });

  it.each([
    ['users', '../admin'],
    ['users/x', 'follow'],
    ['', 'follow'],
    ['users', 'follow?x=1'],
  ])('refuses a call name that is not a plain identifier: %s.%s', (port, method) => {
    expect(() => portCallPath(port, method)).toThrow(TypeError);
  });

  it('drops trailing undefined arguments so the method defaults apply', () => {
    expect(encodeArgs(['a', 20, undefined, undefined])).toEqual(['a', 20]);
    expect(encodeArgs([])).toEqual([]);
  });

  it('keeps an inner undefined argument undefined across JSON', () => {
    const wire: unknown = JSON.parse(JSON.stringify(encodeArgs(['a', undefined, null, 'c'])));

    expect(decodeArgs(wire as unknown[])).toEqual(['a', undefined, null, 'c']);
  });

  it('leaves ordinary values alone, including objects that merely contain the marker key', () => {
    const args = [{ $undefined: true, other: 1 }, { $undefined: false }, [undefined], 0, '', false];

    expect(decodeArgs(encodeArgs(args))).toEqual(args);
  });
});

describe('dates on the wire', () => {
  const when = new Date('2026-11-21T10:00:00.000Z');

  it('survives JSON as a Date, at any depth', () => {
    const value = { acceptedAt: when, history: [{ at: when, note: 'x' }], none: null };

    const { value: marked, typed } = markDates(value);
    const received = reviveDates(JSON.parse(JSON.stringify(marked)));

    expect(typed).toBe(true);
    expect(received).toEqual(value);
    expect((received as typeof value).history[0]?.at).toBeInstanceOf(Date);
  });

  it('hands back the very same value when it holds no date', () => {
    const value = { id: 'a', tags: ['x'], nested: { n: 1 } };

    const marked = markDates(value);

    expect(marked.typed).toBe(false);
    expect(marked.value).toBe(value);
  });

  it('keeps an invalid date invalid instead of failing', () => {
    const received = reviveDates(JSON.parse(JSON.stringify(markDates({ at: new Date('nope') }).value))) as { at: Date };

    expect(received.at).toBeInstanceOf(Date);
    expect(Number.isNaN(received.at.getTime())).toBe(true);
  });

  it('does not mistake ordinary objects for a date', () => {
    const value = { $date: '2026-01-01', other: 1 };

    expect(reviveDates(value)).toEqual(value);
    expect(reviveDates('2026-11-21T10:00:00.000Z')).toBe('2026-11-21T10:00:00.000Z');
  });
});
