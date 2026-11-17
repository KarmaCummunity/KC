// FR-IMPORT-007 AC3 — the provenance chip's words.
import { describe, expect, it } from 'vitest';
import { provenanceLabelKey } from '../importProvenance';

describe('provenanceLabelKey', () => {
  it('names the known platforms', () => {
    expect(provenanceLabelKey('whatsapp')).toBe('postImport.provenance.whatsapp');
    expect(provenanceLabelKey('facebook')).toBe('postImport.provenance.facebook');
    expect(provenanceLabelKey('yad2')).toBe('postImport.provenance.yad2');
  });

  it('says only "imported" when the platform is other or unknown', () => {
    expect(provenanceLabelKey('other')).toBe('postImport.provenance.imported');
    expect(provenanceLabelKey('unknown')).toBe('postImport.provenance.imported');
  });

  it('a post made in KC has no chip', () => {
    expect(provenanceLabelKey(null)).toBeNull();
    expect(provenanceLabelKey(undefined)).toBeNull();
  });
});
