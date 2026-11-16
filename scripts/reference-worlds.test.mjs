// Guards the giving-world settings of the reference seed (supabase/seed/reference/data/) against
// the PM's launch decision (D165, docs/spec/90_decisions_log.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DATA = fileURLToPath(new URL('../supabase/seed/reference/data/', import.meta.url));

/** Rows of a reference CSV as objects. No field of these two files holds a comma. */
function rows(file) {
  const [header, ...lines] = readFileSync(`${DATA}${file}`, 'utf8').trim().split('\n');
  const columns = header.split(',');
  return lines.map((line) => Object.fromEntries(line.split(',').map((value, i) => [columns[i], value])));
}

test('every world shows its posts in the main feed', () => {
  const hidden = rows('worlds.csv').filter((w) => w.shows_in_main_feed !== 'true').map((w) => w.slug);
  assert.deepEqual(hidden, []);
});

test('the launch flags: medical, democracy and money stay portals; knowledge and challenges are active', () => {
  const flags = Object.fromEntries(rows('app_flags.csv').map((f) => [f.key, f.enabled]));
  for (const slug of ['medical', 'democracy', 'money']) assert.equal(flags[`world_${slug}_enabled`], 'false', slug);
  for (const slug of ['items', 'food', 'rides', 'time', 'knowledge', 'challenges']) {
    assert.equal(flags[`world_${slug}_enabled`], 'true', slug);
  }
});

test('every world has exactly one launch flag', () => {
  const flags = new Set(rows('app_flags.csv').map((f) => f.key));
  const missing = rows('worlds.csv').map((w) => `world_${w.slug}_enabled`).filter((key) => !flags.has(key));
  assert.deepEqual(missing, []);
});

test('the animals world is open to every member: no verified identity needed (PM 2026-11-16, #2254)', () => {
  // docs/spec/05_giving_worlds.md §5.9: everyone may publish and take; the D125 verification rule is lifted.
  const animals = rows('worlds.csv').find((w) => w.slug === 'animals');
  assert.ok(animals, 'animals world missing from worlds.csv');
  assert.equal(animals.requires_verification, 'false');
  assert.equal(animals.shows_in_main_feed, 'true');
});
