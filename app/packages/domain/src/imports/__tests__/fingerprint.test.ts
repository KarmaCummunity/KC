import { describe, expect, it } from 'vitest';
import { canonicalFingerprintText } from '../fingerprint';

describe('canonicalFingerprintText', () => {
  it('is stable across case, punctuation, emoji, spacing and digit values', () => {
    const a = canonicalFingerprintText('Sofa FREE!!! 😀 floor 3, call <PHONE>');
    const b = canonicalFingerprintText('sofa free floor 4 call <PHONE>');
    expect(a).toBe(b);
  });

  it('keeps Hebrew words and placeholders, drops the rest', () => {
    expect(canonicalFingerprintText('מוסר ספה!!! קומה 3 — <PHONE>')).toBe('מוסר ספה קומה # <phone>');
  });

  it('differs for different content', () => {
    expect(canonicalFingerprintText('מוסר ספה')).not.toBe(canonicalFingerprintText('מחפש ספה'));
  });
});
