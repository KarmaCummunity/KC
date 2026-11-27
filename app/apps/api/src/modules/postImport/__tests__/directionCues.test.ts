import { expect, it } from 'vitest';
import { directionCues } from '../directionCues';

it('offer words are recognized as whole words', () => {
  expect(directionCues('מוסר ספה בחינם')).toEqual({ offer: true, request: false });
  expect(directionCues('ומוסרת שולחן')).toEqual({ offer: true, request: false });
  expect(directionCues('giving away a sofa')).toEqual({ offer: true, request: false });
});

it('request words are recognized', () => {
  expect(directionCues('מחפש מזרן לילד')).toEqual({ offer: false, request: true });
  expect(directionCues('Looking for a stroller')).toEqual({ offer: false, request: true });
});

it('both kinds of words are reported as a conflict', () => {
  expect(directionCues('מוסר ספה ומחפש שולחן')).toEqual({ offer: true, request: true });
});

it('a word inside a longer word does not count', () => {
  expect(directionCues('מוסרים')).toEqual({ offer: true, request: false });
  expect(directionCues('הצריכה')).toEqual({ offer: false, request: false });
  expect(directionCues('המציעים הגדולים')).toEqual({ offer: false, request: false });
});

it('no cue at all', () => {
  expect(directionCues('ספה תלת מושבית, קומה 3')).toEqual({ offer: false, request: false });
});
