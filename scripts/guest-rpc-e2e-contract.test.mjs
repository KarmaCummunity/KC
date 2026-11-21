import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Keep the deployed privilege probe aligned with the deliberately public guest read.
test('the E2E public list includes the reviewed guest RPC grant', () => {
  const migration = readFileSync(new URL('../supabase/migrations/0081_guest_posts.sql', import.meta.url), 'utf8');
  const probe = readFileSync(new URL('../tests/e2e/journeys/db-function-privileges.spec.ts', import.meta.url), 'utf8');
  assert.match(migration, /grant execute on function public\.guest_posts\(uuid, uuid, integer\) to anon, authenticated;/);
  const list = probe.match(/const ANON_CALLABLE[^=]*= new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(list, 'the explicit reviewed list remains present');
  assert.match(list[1], /'guest_posts'/);
  assert.match(probe, /expect\(reachable,.*\)\.toEqual\(\[\]\)/);
});
