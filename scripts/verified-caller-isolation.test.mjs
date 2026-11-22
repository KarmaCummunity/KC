import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const schema = read('supabase/schemas/95_platform/050_edge_invocation.sql');
const migrationNames = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter(name => /^(?:next-\d{2}|\d{4})_verified_edge_caller\.sql$/.test(name));
assert.equal(migrationNames.length, 1);
const migration = read('supabase/migrations/' + migrationNames[0]);

function definition(sql) {
  return sql.slice(sql.indexOf('create ' + (sql.includes('create or replace function kc_private.invoke_edge_function(') ? 'or replace ' : '') + 'function kc_private.invoke_edge_function('), sql.indexOf('-- ── Immediate start') < 0 ? undefined : sql.indexOf('-- ── Immediate start')).trim().replace('create or replace function', 'create function');
}

test('migration changes only the key name in the frozen function, preserving signature/definer/search path', () => {
  assert.equal(definition(migration), definition(schema).replaceAll('kc_service_role_key', 'kc_verified_service_role_key'));
  assert.match(migration, /create or replace function kc_private\.invoke_edge_function\(p_function text, p_body jsonb default '\{\}'::jsonb\)/);
  assert.match(migration, /security definer\nset search_path = ''/);
  const body = definition(migration);
  assert.match(body, /using 'kc_project_url', 'kc_verified_service_role_key'/);
  assert.doesNotMatch(body, /'kc_service_role_key'/);
  assert.match(body, /return null;/);
  assert.doesNotMatch(migration, /\b(?:drop|grant|revoke|alter|insert|update|delete)\s+(?:table|function|schema|into|from|all|kc_private\.)/i);
});

test('both reviewed writers populate only verified slot after validated retrieval', () => {
  for (const file of ['deploy-db.yml', 'seed-kc-dev.yml']) {
    const text = read('.github/workflows/' + file);
    const marker = file === 'deploy-db.yml' ? '      - name: Vault secrets for' : '      - name: Set the Vault secrets';
    const start = text.indexOf(marker);
    const step = text.slice(start, text.indexOf('SQL\n', start) + 4);
    assert.match(step, /node scripts\/release\/service-role-key\.mjs/);
    assert.ok(step.indexOf('service-role-key.mjs') < step.indexOf('vault.create_secret'));
    assert.match(step, /vault\.create_secret\(:'vault_key', 'kc_verified_service_role_key'\)/);
    assert.match(step, /vault\.update_secret\(id, :'vault_key'\) from vault\.secrets where name = 'kc_verified_service_role_key'/);
    assert.doesNotMatch(step, /'kc_service_role_key'|supabase projects api-keys/);
  }
});

test('migration precedes verified-slot write, and old migrations remain immutable', () => {
  const text = read('.github/workflows/deploy-db.yml');
  assert.ok(text.indexOf('- name: Apply migrations') < text.indexOf('- name: Vault secrets for'));
  assert.match(read('supabase/migrations/0001_baseline.sql'), /using 'kc_project_url', 'kc_service_role_key'/);
  assert.match(read('supabase/tests/096_jobs.sql'), /legacy-only caller fails closed, never falls back/);
  assert.match(read('supabase/tests/096_jobs.sql'), /replaying the obsolete writer cannot change the actual caller/);
});

// Frozen baseline sources are history. Only current incremental function bodies
// are checked, so docs, comments, fixtures and legacy-writer names are not banned.
function legacyCallerReaders(sql) {
  const withoutComments = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
  const functions = withoutComments.matchAll(/\bcreate\s+(?:or\s+replace\s+)?function\s+([a-z_][a-z_0-9]*\.[a-z_][a-z_0-9]*)\s*\([\s\S]*?\bas\s+(\$[a-z_0-9]*\$)([\s\S]*?)\2\s*;/gi);
  return [...functions].filter(match => /\bfrom\s+vault\s*\.\s*decrypted_secrets\b/i.test(match[3]) && /'kc_service_role_key'/.test(match[3])).map(match => match[1]);
}

function sqlFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    return entry.isDirectory() ? sqlFiles(path) : entry.name.endsWith('.sql') ? [path] : [];
  });
}

test('current incremental and canonical function sources cannot add a legacy caller reader', () => {
  const migrations = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter(name => /^(?:next-\d{2}|\d{4})_.+\.sql$/.test(name) && !name.startsWith('0001_')).map(name => new URL('../supabase/migrations/' + name, import.meta.url));
  const sources = sqlFiles(new URL('../supabase/migration-sources/', import.meta.url));
  const violations = [...migrations, ...sources].flatMap(path => legacyCallerReaders(readFileSync(path, 'utf8')).map(name => path.pathname + ': ' + name));
  assert.deepEqual(violations, []);
});

test('reader guard catches separate dispatch helpers without banning legitimate old-slot references', () => {
  const reader = `create function kc_private.dispatch_only(p_scope jsonb) returns bigint language plpgsql security definer set search_path = '' as $fn$ begin execute 'select s.decrypted_secret from vault.decrypted_secrets s where s.name = $1' using 'kc_service_role_key'; return null; end; $fn$;`;
  assert.deepEqual(legacyCallerReaders(reader), ['kc_private.dispatch_only']);
  assert.deepEqual(legacyCallerReaders(reader.replace("'kc_service_role_key'", "'kc_verified_service_role_key'")), []);
  assert.deepEqual(legacyCallerReaders("-- 'kc_service_role_key' from vault.decrypted_secrets\nselect 1;"), []);
  assert.deepEqual(legacyCallerReaders("comment on function kc_private.example() is 'kc_service_role_key';"), []);
  assert.deepEqual(legacyCallerReaders("create function kc_private.legacy_writer() returns void language sql as $$ select vault.update_secret(id, 'x') from vault.secrets where name = 'kc_service_role_key'; $$;"), []);
});
