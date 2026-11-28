import { randomUUID } from 'node:crypto';
import type { ParameterShape, PortArgShapes, Shape } from '../../platform/ports/argShapes';

/** Values a sample may draw on, so calls act on the test member instead of on nothing. */
export interface SampleContext {
  readonly memberId: string;
  readonly otherMemberId: string;
}

const PERSON = /user|owner|follower|followed|requester|target|viewer|member|author|actor|blocker|blocked/i;

/** A plausible string for a parameter or field, judged by its name. */
function sampleString(name: string, context: SampleContext): string {
  if (/ids?$/i.test(name) || name === 'id') {
    if (!PERSON.test(name)) return randomUUID();
    return /follow(ed|er)?|target|other|blocked|requester/i.test(name) ? context.otherMemberId : context.memberId;
  }
  // Unique among members: a token is one device's, and a second member sending the same one is a conflict, not a sample.
  if (/token/i.test(name)) return `sample-${context.memberId.slice(0, 8)}`;
  if (/slug/i.test(name)) return 'food';
  if (/handle/i.test(name)) return 'sample_handle';
  if (/(date|at|time|from|to|since|until)$/i.test(name)) return '2026-11-21T10:00:00.000Z';
  if (/url|link/i.test(name)) return 'https://example.org/page';
  if (/phone/i.test(name)) return '+972500000000';
  if (/city/i.test(name)) return '5000';
  return 'sample';
}

/**
 * A value that satisfies `shape`, built from the shape alone. Required fields
 * only: the goal is one well-typed call per method, not a meaningful one.
 */
export function sampleValue(shape: Shape, name: string, types: PortArgShapes['types'], context: SampleContext, depth = 0): unknown {
  if (depth > 8) return undefined;
  switch (shape) {
    case 'string':
      return sampleString(name, context);
    case 'number':
      return 5;
    case 'boolean':
      return true;
    case 'null':
      return null;
    case 'undefined':
      return undefined;
    case 'unknown':
      return {};
  }
  if ('literal' in shape) return shape.literal;
  if ('ref' in shape) return sampleValue(types[shape.ref] ?? 'unknown', name, types, context, depth + 1);
  if ('union' in shape) {
    const member = shape.union.find((candidate) => candidate !== 'undefined' && candidate !== 'null') ?? shape.union[0] ?? 'unknown';
    return sampleValue(member, name, types, context, depth + 1);
  }
  if ('array' in shape) return [sampleValue(shape.array, name.replace(/s$/, ''), types, context, depth + 1)];
  if ('tuple' in shape) return shape.tuple.map((member, index) => sampleValue(member, `${name}${index}`, types, context, depth + 1));
  if ('record' in shape) return {};
  const object: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(shape.object)) {
    if (!shape.optional?.includes(key)) object[key] = sampleValue(member, key, types, context, depth + 1);
  }
  return object;
}

/** Arguments for one call of a method: every required parameter, no optional one. */
export function sampleArgs(parameters: readonly ParameterShape[], types: PortArgShapes['types'], context: SampleContext): unknown[] {
  return parameters.filter((parameter) => !parameter.optional).map((parameter) => sampleValue(parameter.shape, parameter.name, types, context));
}
