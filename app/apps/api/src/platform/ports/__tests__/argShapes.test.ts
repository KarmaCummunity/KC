import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findArgsProblem, type ParameterShape, type PortArgShapes, type Shape } from '../argShapes';
import generated from '../portArgShapes.generated.json';

const shapes = generated as unknown as PortArgShapes;

const TYPES: PortArgShapes['types'] = {
  Address: { object: { city: 'string', street: { union: ['string', 'null'] }, floor: 'number' }, optional: ['floor'] },
  Tree: { object: { label: 'string', children: { array: { ref: 'Tree' } } } },
};

const parameters = (...shape: Array<Shape | ParameterShape>): ParameterShape[] =>
  shape.map((entry, index) => (typeof entry === 'object' && 'name' in entry ? entry : { name: `p${index}`, shape: entry }));

const problem = (args: unknown[], ...shape: Array<Shape | ParameterShape>) => findArgsProblem(args, parameters(...shape), TYPES);

describe('findArgsProblem', () => {
  it('accepts arguments that match', () => {
    expect(problem(['a', 1, true, null], 'string', 'number', 'boolean', 'null')).toBeNull();
  });

  it.each([
    ['a number where a string is expected', [1], 'string', 'p0: expected string'],
    ['a string where a number is expected', ['1'], 'number', 'p0: expected number'],
    ['null where a string is expected', [null], 'string', 'p0: expected string'],
    ['an object where a string is expected', [{ toString: 'x' }], 'string', 'p0: expected string'],
    ['a value outside a literal union', ['maybe'], { union: [{ literal: 'yes' }, { literal: 'no' }] } as Shape, 'p0: no allowed form matches'],
    ['a string where a list is expected', ['a,b'], { array: 'string' } as Shape, 'p0: expected a list'],
    ['a wrong element in a list', [['a', 2]], { array: 'string' } as Shape, 'p0[1]: expected string'],
    ['a list where an object is expected', [[]], { ref: 'Address' } as Shape, 'p0: expected an object'],
    ['a wrong value in a record', [{ a: 1, b: 'x' }], { record: 'number' } as Shape, 'p0.b: expected number'],
  ])('refuses %s', (_case, args, shape, expected) => {
    expect(problem(args, shape as Shape)).toBe(expected);
  });

  it('checks objects by their fields, lets optional ones be absent and unknown ones pass', () => {
    const address: Shape = { ref: 'Address' };

    expect(problem([{ city: 'TLV', street: null }], address)).toBeNull();
    expect(problem([{ city: 'TLV', street: 'a', floor: 3, addedByANewerApp: true }], address)).toBeNull();
    expect(problem([{ city: 'TLV' }], address)).toBe('p0.street: no allowed form matches');
    expect(problem([{ city: 5, street: null }], address)).toBe('p0.city: expected string');
    expect(problem([{ city: 'TLV', street: null, floor: '3' }], address)).toBe('p0.floor: expected number');
  });

  it('follows references, including a type that contains itself', () => {
    const tree: Shape = { ref: 'Tree' };

    expect(problem([{ label: 'a', children: [{ label: 'b', children: [] }] }], tree)).toBeNull();
    expect(problem([{ label: 'a', children: [{ label: 1, children: [] }] }], tree)).toBe('p0.children[0].label: expected string');
  });

  it('requires required parameters and lets optional ones be skipped or left out', () => {
    const limit: ParameterShape = { name: 'limit', shape: 'number' };
    const cursor: ParameterShape = { name: 'cursor', shape: { union: ['undefined', 'string'] }, optional: true };

    expect(findArgsProblem([10], [limit, cursor], TYPES)).toBeNull();
    expect(findArgsProblem([10, undefined], [limit, cursor], TYPES)).toBeNull();
    expect(findArgsProblem([10, 'c'], [limit, cursor], TYPES)).toBeNull();
    expect(findArgsProblem([], [limit, cursor], TYPES)).toBe('limit: required');
    expect(findArgsProblem([undefined, 'c'], [limit, cursor], TYPES)).toBe('limit: required');
    expect(findArgsProblem([10, 5], [limit, cursor], TYPES)).toBe('cursor: no allowed form matches');
  });

  it('refuses more arguments than the method takes, unless it takes a rest parameter', () => {
    expect(problem(['a', 'b'], 'string')).toBe('expected at most 1 arguments, got 2');
    expect(findArgsProblem(['a', 1, 2, 3], [{ name: 'first', shape: 'string' }, { name: 'more', shape: 'number', optional: true, rest: true }], TYPES)).toBeNull();
    expect(findArgsProblem(['a', 1, 'x'], [{ name: 'first', shape: 'string' }, { name: 'more', shape: 'number', optional: true, rest: true }], TYPES)).toBe(
      'more: expected number',
    );
  });

  it('checks tuples by position and accepts anything where the shape is unknown', () => {
    expect(problem([['a', 1]], { tuple: ['string', 'number'] })).toBeNull();
    expect(problem([['a', 'b']], { tuple: ['string', 'number'] })).toBe('p0[1]: expected number');
    expect(problem([['a', 1, 2]], { tuple: ['string', 'number'] })).toBe('p0: expected a list of 2');
    expect(problem([{ anything: [1, 'x', null] }], 'unknown')).toBeNull();
    expect(problem([1], { ref: 'NoSuchType' })).toBeNull();
  });
});

describe('generated port argument shapes', () => {
  it('describe the methods the contracts call', () => {
    expect(shapes.ports.user?.follow).toEqual([
      { name: 'followerId', shape: 'string' },
      { name: 'followedId', shape: 'string' },
    ]);
    expect(shapes.ports.savedPosts?.listSavedPosts?.[1]).toMatchObject({ name: 'cursor', optional: true });
  });

  it('leave very few parameters unchecked', () => {
    const all = Object.values(shapes.ports).flatMap((methods) => Object.values(methods).flat());
    const unknown = all.filter((parameter) => parameter.shape === 'unknown');

    expect(all.length).toBeGreaterThan(400);
    expect(unknown.length).toBeLessThanOrEqual(5);
  });

  it('are up to date with the port interfaces', () => {
    const script = fileURLToPath(new URL('../../../../scripts/generate-port-args.mjs', import.meta.url));

    // Throws, with the instruction to regenerate, when a port interface changed without the file.
    expect(() => execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' })).not.toThrow();
  }, 60_000);
});
