import { describe, expect, it } from 'vitest';
import { resolveDateFnsLocale } from '../resolveDateFnsLocale';

describe('resolveDateFnsLocale', () => {
  it('returns Hebrew locale for he and he-IL', () => {
    expect(resolveDateFnsLocale('he').code).toBe('he');
    expect(resolveDateFnsLocale('he-IL').code).toBe('he');
  });

  it('returns English locale for en and en-US', () => {
    expect(resolveDateFnsLocale('en').code).toBe('en-US');
    expect(resolveDateFnsLocale('en-US').code).toBe('en-US');
  });

  it('falls back to Hebrew for unknown languages', () => {
    expect(resolveDateFnsLocale('fr').code).toBe('he');
  });
});
