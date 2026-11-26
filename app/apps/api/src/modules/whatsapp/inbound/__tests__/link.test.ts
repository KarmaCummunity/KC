import { describe, expect, it } from 'vitest';
import { linkReply, parseLinkCode } from '../link';

describe('WhatsApp link', () => {
  it('parseLinkCode accepts bare and prefixed 6-digit codes', () => {
    expect(parseLinkCode('123456')).toEqual({ code: '123456', lang: 'he' });
    expect(parseLinkCode(' LINK 004321 ')).toEqual({ code: '004321', lang: 'en' });
    expect(parseLinkCode('\u05e7\u05d9\u05e9\u05d5\u05e8: 111222')).toEqual({ code: '111222', lang: 'he' });
  });

  it('parseLinkCode ignores other text and wrong lengths', () => {
    expect(parseLinkCode('I have 123456 chairs')).toEqual(null);
    expect(parseLinkCode('12345')).toEqual(null);
    expect(parseLinkCode('1234567')).toEqual(null);
  });

  it('linkReply is localised', () => {
    expect(linkReply('linked', 'en').includes('linked')).toEqual(true);
    expect(/[\u0590-\u05ff]/.test(linkReply('invalid', 'he'))).toEqual(true);
  });

  it('parseLinkCode takes the word with or without spaces, a colon or a dash around it', () => {
    for (const text of ['link123456', 'link 123456', 'link:123456', 'link : 123456', 'link -123456', 'LINK   -   123456', '  connect:  123456  ']) {
      expect(parseLinkCode(text), text).toEqual({ code: '123456', lang: 'en' });
    }
    for (const text of ['link :: 123456', 'link 123 456', 'the link 123456', 'link 123456 please']) expect(parseLinkCode(text), text).toEqual(null);
  });

  it('parseLinkCode answers a very long message of spaces at once', () => {
    const startedAt = Date.now();

    expect(parseLinkCode(`link${' '.repeat(100_000)}x`)).toEqual(null);
    expect(parseLinkCode(`${' '.repeat(100_000)}123456${' '.repeat(100_000)}`)).toEqual({ code: '123456', lang: 'he' });
    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});
