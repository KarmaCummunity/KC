import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectClientRpcs, parseGrantRows, findUngrantedRpcs } from './check-rpc-grants.mjs';

// Builds a throwaway repo with the two client source trees the guard scans.
function withRepo(files, run) {
  const root = mkdtempSync(join(tmpdir(), 'rpc-grants-'));
  try {
    for (const [path, content] of Object.entries(files)) {
      const full = join(root, path);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, content);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('collects RPCs from the adapters and the mobile app, including multi-line calls', () => {
  withRepo(
    {
      'app/packages/infrastructure-supabase/src/Repo.ts': `client.rpc('browse_listings', {});\nclient.rpc(\n  'rpc_my_matches',\n  {},\n);`,
      'app/apps/mobile/src/hooks/useThing.ts': `supabase.rpc("is_super_admin");`,
    },
    (root) => {
      assert.deepEqual(collectClientRpcs({ repoRoot: root }), ['browse_listings', 'is_super_admin', 'rpc_my_matches']);
    },
  );
});

test('ignores test files and de-duplicates names', () => {
  withRepo(
    {
      'app/packages/infrastructure-supabase/src/A.ts': `c.rpc('share_listing_to_feed'); c.rpc('share_listing_to_feed');`,
      'app/packages/infrastructure-supabase/src/__tests__/A.test.ts': `c.rpc('only_in_tests');`,
      'app/apps/mobile/src/B.test.ts': `c.rpc('only_in_unit_test');`,
    },
    (root) => {
      assert.deepEqual(collectClientRpcs({ repoRoot: root }), ['share_listing_to_feed']);
    },
  );
});

test('parses psql unaligned rows and skips blank lines', () => {
  const callable = parseGrantRows('browse_listings|t\nenqueue_notification|f\n\n');
  assert.equal(callable.get('browse_listings'), true);
  assert.equal(callable.get('enqueue_notification'), false);
  assert.equal(callable.size, 2);
});

test('passes when every client RPC is executable by a client role', () => {
  const callable = new Map([['browse_listings', true], ['rpc_my_matches', true]]);
  assert.deepEqual(findUngrantedRpcs(['browse_listings', 'rpc_my_matches'], callable), []);
});

test('reports an RPC whose migration did not grant a client role', () => {
  const errors = findUngrantedRpcs(['start_listing_chat'], new Map([['start_listing_chat', false]]));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /start_listing_chat/);
  assert.match(errors[0], /to authenticated/);
});

test('reports an RPC that does not exist in the database', () => {
  const errors = findUngrantedRpcs(['dropped_rpc'], new Map());
  assert.equal(errors.length, 1);
  assert.match(errors[0], /no function public\.dropped_rpc exists/);
});
