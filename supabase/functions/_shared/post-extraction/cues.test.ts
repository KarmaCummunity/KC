import { assertEquals } from 'jsr:@std/assert@1';
import { directionCues } from './cues.ts';

Deno.test('offer words are recognized as whole words', () => {
  assertEquals(directionCues('מוסר ספה בחינם'), { offer: true, request: false });
  assertEquals(directionCues('ומוסרת שולחן'), { offer: true, request: false });
  assertEquals(directionCues('giving away a sofa'), { offer: true, request: false });
});

Deno.test('request words are recognized', () => {
  assertEquals(directionCues('מחפש מזרן לילד'), { offer: false, request: true });
  assertEquals(directionCues('Looking for a stroller'), { offer: false, request: true });
});

Deno.test('both kinds of words are reported as a conflict', () => {
  assertEquals(directionCues('מוסר ספה ומחפש שולחן'), { offer: true, request: true });
});

Deno.test('a word inside a longer word does not count', () => {
  assertEquals(directionCues('מוסרים'), { offer: true, request: false });
  assertEquals(directionCues('הצריכה'), { offer: false, request: false });
  assertEquals(directionCues('המציעים הגדולים'), { offer: false, request: false });
});

Deno.test('no cue at all', () => {
  assertEquals(directionCues('ספה תלת מושבית, קומה 3'), { offer: false, request: false });
});
