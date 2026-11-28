import { describe, expect, it } from 'vitest';
import { postMenuEn } from '../locales/en/modules/postMenu';
import { postMenuHe } from '../locales/he/modules/postMenu';
describe('post deletion confirmation matches recoverable deletion', () => {
  it('explains active-list removal, recovery and preserved chats in English', () => {
    expect(postMenuEn.deleteConfirmBody).toContain('removed from active listings');
    expect(postMenuEn.deleteConfirmBody).toContain('reopen');
    expect(postMenuEn.deleteConfirmBody).toContain('scheduled deletion');
    expect(postMenuEn.deleteConfirmBody).not.toContain('permanently deleted');
  });
  it('explains the same recovery window in Hebrew', () => {
    expect(postMenuHe.deleteConfirmBody).toContain('יוסר מהפוסטים הפעילים');
    expect(postMenuHe.deleteConfirmBody).toContain('חלון השחזור');
    expect(postMenuHe.deleteConfirmBody).toContain('שיחות קיימות');
    expect(postMenuHe.deleteConfirmBody).not.toContain('לצמיתות');
  });
});
