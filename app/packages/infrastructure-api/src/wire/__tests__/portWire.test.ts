import { describe, expect, it } from 'vitest';
import { decodeArgs, encodeArgs, portCallPath } from '../portWire';

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
