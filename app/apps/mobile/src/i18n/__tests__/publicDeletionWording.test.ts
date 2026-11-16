// The public store pages must describe the real deletion flow (D108, FR-SETTINGS-012,
// FR-AUTH-016): hide immediately, restorable for 30 days, then permanent purge.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function load(page: 'privacy' | 'delete-account'): string {
  return readFileSync(path.resolve(__dirname, `../../../public/${page}.html`), 'utf8');
}

const FORBIDDEN = [
  'deleted immediately',
  'no undo window',
  'נמחקים מיד',
  'אין חלון ביטול',
];

describe.each(['privacy', 'delete-account'] as const)('public /%s deletion wording', (page) => {
  it('does not promise immediate irreversible deletion', () => {
    const html = load(page);
    for (const phrase of FORBIDDEN) {
      expect(html, phrase).not.toContain(phrase);
    }
  });

  it('describes the 30-day restorable grace period in both languages', () => {
    const html = load(page);
    expect(html).toContain('30 days');
    expect(html).toContain('30 יום');
    expect(html).toContain('permanently deleted');
    expect(html).toContain('לצמיתות');
    expect(html).toMatch(/restore it|fully restored/);
    expect(html).toMatch(/לשחזר|לשחזור/);
  });
});

describe('public /privacy last-updated date', () => {
  it('is 2026-11-15 in both languages', () => {
    const html = load('privacy');
    expect(html).toContain('Last updated: 2026-11-15');
    expect(html).toContain('עודכן לאחרונה: 2026-11-15');
    expect(html).not.toContain('2026-10-17');
  });
});

describe('public /delete-account in-app instructions', () => {
  it('uses the in-app button labels and the existing contact email', () => {
    const html = load('delete-account');
    expect(html).toContain('<b>Delete the account</b>');
    expect(html).toContain('<b>מחיקת החשבון</b>');
    expect(html).toContain('karmacommunity2.0@gmail.com');
    expect(html).not.toContain('Permanently delete the account');
    expect(html).not.toContain('מחק את החשבון לצמיתות');
  });
});
