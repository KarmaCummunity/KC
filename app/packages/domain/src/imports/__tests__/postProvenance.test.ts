// FR-IMPORT-007 AC3 — the provenance a post card shows.
import { describe, expect, it } from 'vitest';
import { importedFromOf } from '../postProvenance';

describe('importedFromOf', () => {
  it('a post made in KC has no provenance, whatever the platform column says', () => {
    expect(importedFromOf('native', null)).toBeNull();
    expect(importedFromOf('native', 'whatsapp')).toBeNull();
    expect(importedFromOf(null, null)).toBeNull();
    expect(importedFromOf(undefined, undefined)).toBeNull();
  });

  it('an imported post reads its platform', () => {
    expect(importedFromOf('imported', 'whatsapp')).toBe('whatsapp');
    expect(importedFromOf('imported', 'facebook')).toBe('facebook');
    expect(importedFromOf('imported', 'yad2')).toBe('yad2');
    expect(importedFromOf('imported', 'other')).toBe('other');
  });

  it('an imported post with a missing or unknown platform still reads imported', () => {
    expect(importedFromOf('imported', null)).toBe('unknown');
    expect(importedFromOf('imported', 'telegram')).toBe('unknown');
  });
});
