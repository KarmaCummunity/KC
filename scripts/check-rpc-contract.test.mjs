import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkRpcContract } from './check-rpc-contract.mjs';

function seedAllowlist(root) {
  writeFileSync(
    join(root, 'scripts/check-rpc-contract.allowlist.json'),
    JSON.stringify({ rpcs: [], tables: [] }, null, 2),
  );
}

function seedTypesStub(root) {
  // Empty types file is fine — corpus is migrations + types, so migrations
  // alone can satisfy lookups.
  const typesPath = join(root, 'app/packages/infrastructure-supabase/src/database.types.ts');
  writeFileSync(typesPath, 'export type Database = {};\n');
}

test('passes when RPC and table exist in migrations', () => {
  const root = mkdtempSync(join(tmpdir(), 'contract-ok-'));
  try {
    const infra = join(root, 'app/packages/infrastructure-supabase/src');
    const migrations = join(root, 'supabase/migrations');
    const scriptsDir = join(root, 'scripts');
    mkdirSync(infra, { recursive: true });
    mkdirSync(migrations, { recursive: true });
    mkdirSync(scriptsDir, { recursive: true });
    seedAllowlist(root);
    seedTypesStub(root);
    writeFileSync(
      join(infra, 'Repo.ts'),
      `client.rpc('feed_ranked_ids', {}); client.from('posts').select();`,
    );
    writeFileSync(
      join(migrations, '0001_posts.sql'),
      `create table public.posts(id uuid primary key);
       create or replace function public.feed_ranked_ids() returns setof uuid language sql as $$ select id from posts $$;`,
    );
    const result = checkRpcContract({ repoRoot: root });
    assert.equal(result.ok, true, result.errors.join('\n'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fails when RPC missing from migrations', () => {
  const root = mkdtempSync(join(tmpdir(), 'contract-bad-'));
  try {
    const infra = join(root, 'app/packages/infrastructure-supabase/src');
    const migrations = join(root, 'supabase/migrations');
    const scriptsDir = join(root, 'scripts');
    mkdirSync(infra, { recursive: true });
    mkdirSync(migrations, { recursive: true });
    mkdirSync(scriptsDir, { recursive: true });
    seedAllowlist(root);
    seedTypesStub(root);
    writeFileSync(join(infra, 'Repo.ts'), `client.rpc('missing_rpc', {});`);
    writeFileSync(join(migrations, '0001_empty.sql'), '-- no rpc');
    const result = checkRpcContract({ repoRoot: root });
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /missing_rpc/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('allowlist suppresses a known symbol', () => {
  const root = mkdtempSync(join(tmpdir(), 'contract-allow-'));
  try {
    const infra = join(root, 'app/packages/infrastructure-supabase/src');
    const migrations = join(root, 'supabase/migrations');
    const scriptsDir = join(root, 'scripts');
    mkdirSync(infra, { recursive: true });
    mkdirSync(migrations, { recursive: true });
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(
      join(scriptsDir, 'check-rpc-contract.allowlist.json'),
      JSON.stringify({ rpcs: ['some_view_rpc'], tables: [] }, null, 2),
    );
    seedTypesStub(root);
    writeFileSync(join(infra, 'Repo.ts'), `client.rpc('some_view_rpc', {});`);
    writeFileSync(join(migrations, '0001_empty.sql'), '-- no rpc');
    const result = checkRpcContract({ repoRoot: root });
    assert.equal(result.ok, true, result.errors.join('\n'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('skips files inside __tests__ directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'contract-skip-tests-'));
  try {
    const infraTests = join(root, 'app/packages/infrastructure-supabase/src/__tests__');
    const migrations = join(root, 'supabase/migrations');
    const scriptsDir = join(root, 'scripts');
    mkdirSync(infraTests, { recursive: true });
    mkdirSync(migrations, { recursive: true });
    mkdirSync(scriptsDir, { recursive: true });
    seedAllowlist(root);
    seedTypesStub(root);
    // RPC referenced only inside __tests__ should not be flagged.
    writeFileSync(join(infraTests, 'fake.test.ts'), `client.rpc('test_only_rpc', {});`);
    writeFileSync(join(migrations, '0001_empty.sql'), '-- no rpc');
    const result = checkRpcContract({ repoRoot: root });
    assert.equal(result.ok, true, result.errors.join('\n'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('passes when RPC and table exist only in the baseline schema sources', () => {
  const root = mkdtempSync(join(tmpdir(), 'contract-baseline-'));
  try {
    const infra = join(root, 'app/packages/infrastructure-supabase/src');
    const module = join(root, 'supabase/schemas/20_posts');
    mkdirSync(infra, { recursive: true });
    mkdirSync(module, { recursive: true });
    mkdirSync(join(root, 'scripts'), { recursive: true });
    seedAllowlist(root);
    seedTypesStub(root);
    writeFileSync(join(infra, 'Repo.ts'), `client.rpc('feed_page', {}); client.from('user_stats').select();`);
    writeFileSync(
      join(module, '010_posts.sql'),
      `create table public.user_stats (user_id uuid primary key);
       create function public.feed_page() returns setof uuid language sql as $$ select null::uuid $$;`,
    );
    const result = checkRpcContract({ repoRoot: root });
    assert.equal(result.ok, true, result.errors.join('\n'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
