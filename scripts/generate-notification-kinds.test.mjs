// Self-test of the notification kind generator: node --test scripts/generate-notification-kinds.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  AUXILIARY_KEYS, build, forwardMigrationFiles, mergeRegistryRows, parseLocaleModule, parseRegistrySql, readRegistry, stripSqlComments, TEXT_ARGS,
} from './generate-notification-kinds.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'generate-notification-kinds.mjs');
const AUXILIARY = Object.fromEntries(AUXILIARY_KEYS.map((key) => [key.replace('notifications.', ''), 'x']));
const row = (overrides = {}) => ({
  kind: 'demo_kind', category: 'critical', default_enabled: true, bypass_preferences: false,
  bypass_quiet_hours: false, sends_push: true, group_window: null,
  title_key: 'notifications.demoTitle', body_key: 'notifications.demoBody', ...overrides,
});
const locale = (extra = {}) => ({ ...AUXILIARY, demoTitle: '{{actorName}}', demoBody: 'text', ...extra });

test('literal rows are read with the column defaults', () => {
  const kinds = parseRegistrySql(`
    -- insert into kc_private.notification_kinds (kind) select 'in_a_comment';
    insert into kc_private.notification_kinds (kind, category, sends_push, group_window, title_key, body_key)
    values
      ('a_kind', 'social', false, interval '1 hour', 'notifications.aTitle', 'notifications.aBody'), -- note
      ('b_kind', 'critical', true, null, 'notifications.b, with comma', 'notifications.it''s');
  `);
  assert.equal(kinds.length, 2);
  assert.deepEqual(kinds[0], {
    default_enabled: true, bypass_preferences: false, bypass_quiet_hours: false, sends_push: false,
    group_window: 3600, kind: 'a_kind', category: 'social', title_key: 'notifications.aTitle', body_key: 'notifications.aBody',
  });
  assert.equal(kinds[1].title_key, 'notifications.b, with comma');
  assert.equal(kinds[1].body_key, "notifications.it's");
});

test('comments are stripped but a string holding two dashes is kept', () => {
  assert.equal(stripSqlComments("select '--x' -- gone\n").trim(), "select '--x'");
});

test('a registry write that is not a literal insert stops the generator', () => {
  const computed = `insert into kc_private.notification_kinds (kind, category, title_key, body_key)
    select m || '_x', 'critical', 't', 'b' from unnest(array['a']) m;`;
  assert.throws(() => parseRegistrySql(computed, 'f.sql'), /f\.sql: the kind registry is written by a statement/);
  assert.throws(() => parseRegistrySql("update kc_private.notification_kinds set sends_push = false where kind = 'a';"), /registry/);
  assert.throws(() => parseRegistrySql("delete from kc_private.notification_kinds where kind = 'a';"), /registry/);
  assert.throws(() => parseRegistrySql("insert into kc_private.notification_kinds (kind) values (lower('A'));"), /literal/);
  assert.throws(() => parseRegistrySql("insert into kc_private.notification_kinds (kind, group_window) values ('a', interval '1 fortnight');"),
    /unsupported interval/);
  assert.deepEqual(parseRegistrySql('select k.* from kc_private.notification_kinds k;'), []);
});

test('the locale module is read as a plain object', () => {
  const source = "// header\nexport const notificationsHe = {\n  a: 'x', // note\n  b: 'it\\'s {{count}}',\n} as const;\n";
  assert.deepEqual(parseLocaleModule(source), { a: 'x', b: "it's {{count}}" });
});

test('a complete kind is described with its text arguments', () => {
  const { kinds, files } = build([row({ group_window: 60 })], locale({ demoGroupedBody: '{{actorName}} +{{othersCount}}' }));
  assert.deepEqual(kinds[0].textArgs, ['actorName', 'othersCount']);
  assert.equal(kinds[0].groupedBodyKey, 'notifications.demoGroupedBody');
  assert.equal(kinds[0].groupWindowSeconds, 60);
  const paths = Object.keys(files);
  assert.equal(paths.length, 3);
  assert.match(files[paths[0]], /demo_kind: \{ category: 'critical'/);
  assert.equal(files[paths[0]], files[paths[1]], 'the app and the worker get the same module');
  assert.deepEqual(Object.keys(JSON.parse(files[paths[2]])).sort(),
    [...AUXILIARY_KEYS, 'notifications.demoBody', 'notifications.demoGroupedBody', 'notifications.demoTitle'].sort());
});

test('every missing piece of a kind is named', () => {
  const failure = (rows, strings) => {
    try {
      build(rows, strings);
    } catch (error) {
      return error.message;
    }
    return '';
  };
  assert.match(failure([row()], { ...AUXILIARY, demoTitle: 't' }), /kind demo_kind: text notifications\.demoBody is missing/);
  assert.match(failure([row({ group_window: 60 })], locale()), /demoGroupedBody is missing.*group window/);
  assert.match(failure([row()], locale({ demoBody: '{{postTitle}}' })), /uses \{\{postTitle\}\}; only actorName/);
  assert.match(failure([row(), row()], locale()), /registered twice/);
  assert.match(failure([row({ category: 'urgent' })], locale()), /unknown category urgent/);
  assert.match(failure([row({ title_key: 'other.demoTitle' })], locale()), /other\.demoTitle is missing/);
  assert.match(failure([row()], { demoTitle: 't', demoBody: 'b' }), /messagePreviewFallback is missing/);
  const both = failure([row({ kind: 'k1' }), row({ kind: 'k2', body_key: 'notifications.nope' })], { ...AUXILIARY, demoTitle: 't' });
  assert.match(both, /kind k1:[\s\S]*kind k2:/, 'all problems are listed at once');
});

test('the text arguments are the five both renderers provide', () => {
  assert.deepEqual(TEXT_ARGS, ['actorName', 'count', 'othersCount', 'messagePreview', 'taskTitle']);
});

test('the repository registry parses and the generated files are up to date', () => {
  const kinds = readRegistry();
  assert.ok(kinds.length >= 57, `expected the baseline kinds, found ${kinds.length}`);
  assert.equal(new Set(kinds.map((k) => k.kind)).size, kinds.length);
  const output = execFileSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf8' });
  assert.match(output, /up to date/);
});

const insert = (kind, push, conflict = '') =>
  `insert into kc_private.notification_kinds (kind, category, sends_push, title_key, body_key) values
   ('${kind}', 'critical', ${push}, 'notifications.t', 'notifications.b') ${conflict};`;

test('a conflict clause decides how a later row meets an earlier one', () => {
  const rows = [
    ...parseRegistrySql(insert('a', true) + insert('b', true)),
    ...parseRegistrySql(insert('a', false, 'on conflict (kind) do update set sends_push = excluded.sends_push')),
    ...parseRegistrySql(insert('b', false, 'on conflict (kind) do nothing')),
    ...parseRegistrySql(insert('c', false, 'on conflict (kind) do nothing')),
  ];
  const merged = mergeRegistryRows(rows);
  assert.deepEqual(merged.map((r) => [r.kind, r.sends_push]), [['a', false], ['b', true], ['c', false]]);
  assert.equal(Object.keys(merged[0]).includes('conflict'), false);
});

test('a plain second insert of a kind is still caught as registered twice', () => {
  const merged = mergeRegistryRows([...parseRegistrySql(insert('demo_kind', true)), ...parseRegistrySql(insert('demo_kind', false))]);
  assert.equal(merged.length, 2);
  assert.throws(() => build(merged.map((r) => row({ kind: r.kind })), locale()), /registered twice/);
});

test('an unsupported conflict clause stops the generator', () => {
  assert.throws(() => parseRegistrySql(insert('a', true, 'on conflict do nothing')), /unsupported conflict clause/);
  assert.throws(() => parseRegistrySql(insert('a', true, 'on conflict (kind) do update set sends_push = true')),
    /excluded/);
  assert.throws(() => parseRegistrySql(insert('a', true, 'on conflict (kind) do update set group_window = excluded.group_window')),
    /does not name/);
});

test('the forward migrations are read after the schemas, by number, without the baseline', () => {
  const root = mkdtempSync(join(tmpdir(), 'kinds-'));
  try {
    mkdirSync(join(root, 'supabase/schemas/50_notifications'), { recursive: true });
    mkdirSync(join(root, 'supabase/migrations/archive'), { recursive: true });
    writeFileSync(join(root, 'supabase/schemas/50_notifications/010_kinds.sql'), insert('a', true));
    writeFileSync(join(root, 'supabase/migrations/0001_baseline.sql'), insert('a', true));
    writeFileSync(join(root, 'supabase/migrations/0012_late.sql'),
      insert('a', false, 'on conflict (kind) do update set sends_push = excluded.sends_push'));
    writeFileSync(join(root, 'supabase/migrations/0003_new.sql'), insert('b', true));
    writeFileSync(join(root, 'supabase/migrations/archive/0500_old.sql'), insert('z', true));
    assert.deepEqual(forwardMigrationFiles(root).map((f) => f.slice(root.length + 1)),
      ['supabase/migrations/0003_new.sql', 'supabase/migrations/0012_late.sql']);
    assert.deepEqual(readRegistry(root).map((r) => [r.kind, r.sends_push]), [['a', false], ['b', true]]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
