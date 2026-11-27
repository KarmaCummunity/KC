import { describe, expect, it } from 'vitest';
import { withoutTrailingSlashes } from '../urlText';

describe('withoutTrailingSlashes', () => {
  it.each([
    ['https://api.kc.test', 'https://api.kc.test'],
    ['https://api.kc.test/', 'https://api.kc.test'],
    ['https://api.kc.test///', 'https://api.kc.test'],
    ['https://api.kc.test/v1/', 'https://api.kc.test/v1'],
    ['/', ''],
    ['', ''],
  ])('turns %j into %j', (text, expected) => {
    expect(withoutTrailingSlashes(text)).toBe(expected);
  });

  it('leaves slashes that are not at the end', () => {
    expect(withoutTrailingSlashes('//a//b')).toBe('//a//b');
  });

  it('takes a very long run of slashes in a time that does not grow with its square', () => {
    const startedAt = Date.now();

    expect(withoutTrailingSlashes(`x${'/'.repeat(200_000)}y`)).toHaveLength(200_002);
    expect(withoutTrailingSlashes('/'.repeat(200_000))).toBe('');
    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});
