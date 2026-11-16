import { describe, expect, it } from 'vitest';
import { IMPORT_MAX_INPUT_CHARS, normalizeMessage } from '../normalizeMessage';

describe('normalizeMessage', () => {
  it('collapses whitespace, strips niqqud and bidi controls (FR-IMPORT-002 AC2)', () => {
    const out = normalizeMessage('‏מוסר   סֵפֶר\n\n\n  בחינם‬ ');
    expect(out.text).toBe('מוסר ספר\n\nבחינם');
    expect(out.truncated).toBe(false);
  });

  it('applies NFKC (full-width digits and ligatures)', () => {
    expect(normalizeMessage('ｏｆｆｅｒ １２').text).toBe('offer 12');
  });

  it('parses an Android WhatsApp prefix into the message timestamp and removes it', () => {
    const out = normalizeMessage('4.11.2026, 12:03 - דנה: מוסרת ספה');
    expect(out.text).toBe('מוסרת ספה');
    // 12:03 Israel time on 4 Nov 2026 (winter, UTC+2) = 10:03Z.
    expect(out.messageAt?.toISOString()).toBe('2026-11-04T10:03:00.000Z');
  });

  it('parses an iOS WhatsApp prefix in both field orders', () => {
    const a = normalizeMessage('[4.11.2026, 12:03:45] דנה: שלום לכולם, מחפש מזרן');
    const b = normalizeMessage('[12:03, 4.11.2026] דנה: שלום לכולם, מחפש מזרן');
    expect(a.messageAt?.toISOString()).toBe('2026-11-04T10:03:00.000Z');
    expect(b.messageAt?.toISOString()).toBe('2026-11-04T10:03:00.000Z');
    expect(a.text).toBe('שלום לכולם, מחפש מזרן');
    expect(b.text).toBe('שלום לכולם, מחפש מזרן');
  });

  it('reads the prefix time in Israel summer time (UTC+3)', () => {
    const out = normalizeMessage('15.7.2026, 09:30 - דנה: טרמפ');
    expect(out.messageAt?.toISOString()).toBe('2026-07-15T06:30:00.000Z');
  });

  it('expands a two-digit year', () => {
    expect(normalizeMessage('4.11.26, 12:03 - דנה: טקסט').messageAt?.getUTCFullYear()).toBe(2026);
  });

  it('keeps messageAt null when there is no prefix, and rejects an impossible date', () => {
    expect(normalizeMessage('מוסר ספה').messageAt).toBeNull();
    expect(normalizeMessage('31.2.2026, 12:03 - דנה: טקסט').messageAt).toBeNull();
  });

  it('removes forwarding artefacts and system lines', () => {
    const out = normalizeMessage('הועבר\nמוסר ספה\n<This message was edited>\n<Media omitted>');
    expect(out.text).toBe('מוסר ספה');
  });

  it('cuts input at the cap and reports it (FR-IMPORT-002 AC1)', () => {
    const out = normalizeMessage('א'.repeat(IMPORT_MAX_INPUT_CHARS + 50));
    expect(out.text.length).toBe(IMPORT_MAX_INPUT_CHARS);
    expect(out.truncated).toBe(true);
  });

  it('does not report truncation at exactly the cap', () => {
    expect(normalizeMessage('א'.repeat(IMPORT_MAX_INPUT_CHARS)).truncated).toBe(false);
  });
});
