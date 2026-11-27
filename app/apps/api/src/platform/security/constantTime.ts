import { timingSafeEqual } from 'node:crypto';

/**
 * Compares two secrets (a token, a signature) in time that depends only on
 * their length, so the answer's timing tells a caller nothing about how much
 * of a guess was right.
 */
export function equalInConstantTime(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
