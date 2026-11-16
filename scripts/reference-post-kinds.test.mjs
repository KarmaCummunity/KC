// Guards the giving-world post kinds of the reference seed (supabase/seed/reference/data/post_kinds.csv).
// The seed is the only source of post kinds on a deployed database (the baseline holds no data, D-228),
// so a kind the app and the server rely on but the seed lacks makes that world unpublishable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(`${ROOT}${path}`, 'utf8');

/** Rows of post_kinds.csv as objects. No field holds a comma, so a plain split is exact. */
function postKinds() {
  const [header, ...lines] = read('supabase/seed/reference/data/post_kinds.csv').trim().split('\n');
  const columns = header.split(',');
  return lines.map((line) => Object.fromEntries(line.split(',').map((value, i) => [columns[i], value])));
}

test('every row has a known direction and a unique world and slug', () => {
  const rows = postKinds();
  for (const row of rows) assert.ok(['offer', 'request'].includes(row.direction), `${row.world_slug}/${row.slug}: ${row.direction}`);
  const keys = rows.map((row) => `${row.world_slug}/${row.slug}`);
  assert.equal(new Set(keys).size, keys.length, 'duplicate world/slug');
});

test('the animals world has the four kinds of D125, each in its direction', () => {
  // docs/spec/05_giving_worlds.md §5.9: hand an animal over or look to adopt one; boarding / pet-sitting offered or asked for.
  const animals = Object.fromEntries(postKinds().filter((row) => row.world_slug === 'animals').map((row) => [row.slug, row.direction]));
  assert.deepEqual(animals, {
    adoption_offer: 'offer',
    adoption_request: 'request',
    foster_offer: 'offer',
    foster_request: 'request',
  });
});

test('every kind the create form has fields for exists in the seed', () => {
  // The animals create form keys its field sets by kind slug; each must be a seeded kind.
  const source = read('app/apps/mobile/src/lib/unifiedCreate/animalsFieldSpecs.ts');
  const formKinds = [...source.matchAll(/^ {2}([a-z_]+): \[/gm)].map((m) => m[1]);
  assert.ok(formKinds.length > 0, 'no field sets found in animalsFieldSpecs.ts');
  const seeded = new Set(postKinds().filter((row) => row.world_slug === 'animals').map((row) => row.slug));
  assert.deepEqual(formKinds.filter((slug) => !seeded.has(slug)), []);
});

test('every kind the server handoff flow names exists in the seed', () => {
  // kc_private.handoff_flow_of gives these animals offers the request flow (reserve, confirm, hand over).
  const sql = read('supabase/schemas/25_handoffs/040_handoff_rpcs.sql');
  const named = [...sql.matchAll(/k\.slug in \(([^)]*)\)/g)].flatMap((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((s) => s[1]));
  assert.ok(named.length > 0, 'no kind slugs found in handoff_flow_of');
  const seeded = new Set(postKinds().map((row) => row.slug));
  assert.deepEqual(named.filter((slug) => !seeded.has(slug)), []);
});
