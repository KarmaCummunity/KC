import { describe, expect, it } from 'vitest';
import { validateListingDetails } from '../validateListingDetails';

const schema = (props: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  properties: props,
  ...extra,
});

describe('validateListingDetails type/format matrix', () => {
  it.each([
    ['integer', 3, null],
    ['integer', 3.5, 'type:f'],
    ['number', 3.5, null],
    ['boolean', 'yes', 'type:f'],
    ['object', {}, null],
    ['object', [], 'type:f'],
    ['array', [], null],
    [['string', 'null'], 'x', null],
  ])('type %j with %j -> %s', (type, value, expected) => {
    expect(validateListingDetails(schema({ f: { type } }), { f: value })).toBe(expected);
  });

  it('default type is string', () => {
    expect(validateListingDetails(schema({ f: {} }), { f: 1 })).toBe('type:f');
  });

  it('const, enum, date-time and string arrays', () => {
    expect(validateListingDetails(schema({ f: { const: 'a' } }), { f: 'b' })).toBe('const:f');
    expect(validateListingDetails(schema({ f: { enum: ['a'] } }), { f: 'b' })).toBe('enum:f');
    expect(validateListingDetails(schema({ f: { format: 'date-time' } }), { f: 'nope' })).toBe('format:f');
    expect(validateListingDetails(schema({ f: { format: 'date-time' } }), { f: '2026-01-01T00:00:00Z' })).toBeNull();
    expect(validateListingDetails(schema({ f: { type: 'array', items: { type: 'string' } } }), { f: ['a', 1] })).toBe('array:f');
  });

  it('required blank strings, extras and nulls', () => {
    expect(validateListingDetails(schema({ f: {} }, { required: ['f'] }), { f: '  ' })).toBe('required:f');
    expect(validateListingDetails(schema({}, { additionalProperties: false }), { g: 1 })).toBe('extra:g');
    expect(validateListingDetails(schema({}), { g: 1 })).toBeNull();
    expect(validateListingDetails(schema({ f: { type: 'integer' } }), { f: null })).toBeNull();
  });
});
