/**
 * The shape language of port arguments, and the check the gateway runs before
 * a call reaches an adapter. Shapes are generated from the port interfaces
 * (`scripts/generate-port-args.mjs`), so they are as strict as the TypeScript
 * types and never stricter: whatever could not be described is `unknown`.
 */

export type Shape =
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'undefined'
  | 'unknown'
  | { readonly literal: string | number | boolean }
  | { readonly array: Shape }
  | { readonly tuple: readonly Shape[] }
  | { readonly record: Shape }
  | { readonly object: Readonly<Record<string, Shape>>; readonly optional?: readonly string[] }
  | { readonly union: readonly Shape[] }
  | { readonly ref: string };

export interface ParameterShape {
  readonly name: string;
  readonly shape: Shape;
  readonly optional?: boolean;
  /** A rest parameter: every remaining argument must match `shape`. */
  readonly rest?: boolean;
}

export interface PortArgShapes {
  readonly ports: Readonly<Record<string, Readonly<Record<string, readonly ParameterShape[]>>>>;
  /** Named shapes that `ref` points to. */
  readonly types: Readonly<Record<string, Shape>>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Why `value` does not match `shape`, as a path into the value, or null when
 * it matches. An object may carry keys the shape does not know: a newer app
 * build can send a field an older server ignores.
 */
function mismatch(value: unknown, shape: Shape, types: PortArgShapes['types'], path: string): string | null {
  switch (shape) {
    case 'unknown':
      return null;
    case 'string':
    case 'boolean':
      return typeof value === shape ? null : `${path}: expected ${shape}`;
    case 'number':
      // JSON has no NaN or Infinity; a number that arrives is finite, but say so anyway.
      return typeof value === 'number' && Number.isFinite(value) ? null : `${path}: expected number`;
    case 'null':
      return value === null ? null : `${path}: expected null`;
    case 'undefined':
      return value === undefined ? null : `${path}: expected nothing`;
  }
  if ('literal' in shape) return value === shape.literal ? null : `${path}: expected ${JSON.stringify(shape.literal)}`;
  if ('ref' in shape) return mismatch(value, types[shape.ref] ?? 'unknown', types, path);
  if ('union' in shape) {
    return shape.union.some((member) => mismatch(value, member, types, path) === null) ? null : `${path}: no allowed form matches`;
  }
  if ('array' in shape) {
    if (!Array.isArray(value)) return `${path}: expected a list`;
    for (let index = 0; index < value.length; index += 1) {
      const problem = mismatch(value[index], shape.array, types, `${path}[${index}]`);
      if (problem) return problem;
    }
    return null;
  }
  if ('tuple' in shape) {
    if (!Array.isArray(value) || value.length > shape.tuple.length) return `${path}: expected a list of ${shape.tuple.length}`;
    for (let index = 0; index < shape.tuple.length; index += 1) {
      const problem = mismatch(value[index], shape.tuple[index] as Shape, types, `${path}[${index}]`);
      if (problem) return problem;
    }
    return null;
  }
  if (!isPlainObject(value)) return `${path}: expected an object`;
  if ('record' in shape) {
    for (const [key, member] of Object.entries(value)) {
      const problem = mismatch(member, shape.record, types, `${path}.${key}`);
      if (problem) return problem;
    }
    return null;
  }
  for (const [key, member] of Object.entries(shape.object)) {
    // JSON drops `undefined` properties, so an absent key is how an optional one arrives.
    if (value[key] === undefined && shape.optional?.includes(key)) continue;
    const problem = mismatch(value[key], member, types, `${path}.${key}`);
    if (problem) return problem;
  }
  return null;
}

/**
 * Checks the arguments of a port call against the method's parameters.
 * @returns What is wrong, naming the parameter, or null when the call is well formed.
 */
export function findArgsProblem(args: readonly unknown[], parameters: readonly ParameterShape[], types: PortArgShapes['types']): string | null {
  const rest = parameters.at(-1)?.rest ? parameters.at(-1) : undefined;
  if (!rest && args.length > parameters.length) return `expected at most ${parameters.length} arguments, got ${args.length}`;

  for (let index = 0; index < Math.max(args.length, parameters.length); index += 1) {
    const parameter = parameters[index] ?? rest;
    if (!parameter) continue;
    const value = args[index];
    if (value === undefined) {
      if (parameter.optional) continue;
      return `${parameter.name}: required`;
    }
    const problem = mismatch(value, parameter.shape, types, parameter.name);
    if (problem) return problem;
  }
  return null;
}
