import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSeedSql, sqlText, toJunctionRow } from './import-road-junctions.mjs';

// Hebrew source values as Unicode escapes (Hebrew text lives only in locale files).
const EXISTING = '\u05E7\u05D9\u05D9\u05DD';
const INTERCHANGE = '\u05DE\u05D7\u05DC\u05E3';
const JUNCTION = '\u05E6\u05D5\u05DE\u05EA';
const NAME = '\u05D2\u05DC\u05D9\u05DC\u05D5\u05EA'; // "Glilot"

const RECORD = {
  STATUS: EXISTING,
  CURRENT: INTERCHANGE,
  NUM: 7,
  HEBREW: NAME,
  LATIN: 'Glilot',
  ARABIC: 'Glilot (ar)',
  RAODS: '2/5',
  X: 180123.456789,
  Y: 670456.123456,
};

test('maps an existing interchange to a catalog row', () => {
  assert.deepEqual(toJunctionRow(RECORD), {
    id: 7,
    kind: 'interchange',
    nameHe: NAME,
    nameEn: 'Glilot',
    nameAr: 'Glilot (ar)',
    roads: '2/5',
    x: 180123.46,
    y: 670456.12,
  });
});

test('keeps existing-to-be-upgraded places and treats a split junction as a junction', () => {
  const upgraded = `${EXISTING} \u05DC\u05E9\u05D3\u05E8\u05D5\u05D2`; // "existing, to be upgraded"
  const split = `${JUNCTION} \u05DE\u05E4\u05D5\u05E6\u05DC`; // "split junction"
  const row = toJunctionRow({ ...RECORD, STATUS: upgraded, CURRENT: split });
  assert.equal(row.kind, 'junction');
});

test('drops planned places, unknown types and rows without a name or coordinates', () => {
  assert.equal(toJunctionRow({ ...RECORD, STATUS: '\u05DE\u05EA\u05D5\u05DB\u05E0\u05DF' }), null); // "planned"
  assert.equal(toJunctionRow({ ...RECORD, CURRENT: null }), null);
  assert.equal(toJunctionRow({ ...RECORD, HEBREW: '  ' }), null);
  assert.equal(toJunctionRow({ ...RECORD, X: null }), null);
});

test('escapes quotes in SQL literals', () => {
  assert.equal(sqlText("Ja'dida"), "'Ja''dida'");
  assert.equal(sqlText(null), 'null');
});

test('renders a seed migration sorted by id with the source credited', () => {
  const sql = renderSeedSql([toJunctionRow({ ...RECORD, NUM: 9 }), toJunctionRow(RECORD)], { fetchedOn: '2026-11-01' });
  assert.match(sql, /zmt_names/);
  assert.match(sql, /CC BY/);
  assert.match(sql, /ST_Transform/);
  assert.ok(sql.indexOf('(7,') < sql.indexOf('(9,'), 'rows are sorted by id');
});
