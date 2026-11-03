import { assertEquals } from 'jsr:@std/assert@1';
import { linkReply, parseLinkCode } from './link.ts';

Deno.test('parseLinkCode accepts bare and prefixed 6-digit codes', () => {
  assertEquals(parseLinkCode('123456'), { code: '123456', lang: 'he' });
  assertEquals(parseLinkCode(' LINK 004321 '), { code: '004321', lang: 'en' });
  assertEquals(parseLinkCode('\u05e7\u05d9\u05e9\u05d5\u05e8: 111222'), { code: '111222', lang: 'he' });
});

Deno.test('parseLinkCode ignores other text and wrong lengths', () => {
  assertEquals(parseLinkCode('I have 123456 chairs'), null);
  assertEquals(parseLinkCode('12345'), null);
  assertEquals(parseLinkCode('1234567'), null);
});

Deno.test('linkReply is localised', () => {
  assertEquals(linkReply('linked', 'en').includes('linked'), true);
  assertEquals(/[\u0590-\u05ff]/.test(linkReply('invalid', 'he')), true);
});
