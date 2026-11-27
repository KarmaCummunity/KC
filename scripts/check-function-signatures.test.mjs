// Self-test of the stale function overload guard: node --test scripts/check-function-signatures.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blankComments,
  checkFunctionSignatures,
  functionStatements,
  migrationOrder,
  readMigrations,
  signatureOf,
} from './check-function-signatures.mjs';

/** A baseline that defines `kc_private.f(uuid)`, as the real baseline defines its functions. */
const BASELINE = {
  file: '0001_baseline.sql',
  sql: 'create function kc_private.f(p_id uuid) returns void language sql as $$ select 1 $$;',
};

const migration = (file, sql) => ({ file, sql });

test('the committed migrations carry no stale overload', () => {
  const result = checkFunctionSignatures(readMigrations());
  assert.deepEqual(result.errors, []);
});

test('a changed parameter list without a drop of the old signature fails, naming both', () => {
  const result = checkFunctionSignatures([
    BASELINE,
    migration('0002_widen.sql', 'begin;\ncreate or replace function kc_private.f(p_id uuid, p_limit integer default 20)\nreturns void language sql as $$ select 1 $$;\ncommit;'),
  ]);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /^0002_widen\.sql:2: kc_private\.f\(uuid,integer\) is created while kc_private\.f\(uuid\) still exists/);
  assert.match(result.errors[0], /drop function kc_private\.f\(uuid\);/);
});

test('dropping the old signature first lets the new one through', () => {
  const result = checkFunctionSignatures([
    BASELINE,
    migration('0002_widen.sql', 'drop function kc_private.f(uuid);\ncreate function kc_private.f(p_id uuid, p_limit integer) returns void language sql as $$ select 1 $$;'),
  ]);
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('a drop written with parameter names and type aliases still matches the signature', () => {
  const result = checkFunctionSignatures([
    migration('0001_baseline.sql', 'create function public.g(p_at timestamp with time zone, p_n int4, p_tags varchar[]) returns void language sql as $$ select 1 $$;'),
    migration('0002_g.sql', 'drop function if exists g(p_at timestamptz, p_n integer, p_tags character varying[]);\ncreate function public.g(p_at timestamptz) returns void language sql as $$ select 1 $$;'),
  ]);
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('a drop without a parameter list removes every signature of the name', () => {
  const result = checkFunctionSignatures([
    BASELINE,
    migration('0002_f.sql', 'drop function kc_private.f;\ncreate function kc_private.f(p_id text) returns void language sql as $$ select 1 $$;'),
  ]);
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('a drop of several functions in one statement removes each of them', () => {
  const result = checkFunctionSignatures([
    migration('0001_baseline.sql', 'create function a.x(uuid) returns void language sql as $$ select 1 $$;\ncreate function a.y(text) returns void language sql as $$ select 1 $$;'),
    migration('0002_xy.sql', 'drop function a.x(uuid), a.y(text) cascade;\ncreate function a.x(bigint) returns void language sql as $$ select 1 $$;\ncreate function a.y(bigint) returns void language sql as $$ select 1 $$;'),
  ]);
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('an overload marked on its create line is allowed', () => {
  const result = checkFunctionSignatures([
    BASELINE,
    migration('0002_overload.sql', 'create function kc_private.f(p_id uuid, p_actor uuid) -- function-overload: allow the guard needs both forms\nreturns void language sql as $$ select 1 $$;'),
  ]);
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('re-creating the same signature (create or replace) is never an overload', () => {
  const result = checkFunctionSignatures([
    BASELINE,
    migration('0002_body.sql', 'create or replace function kc_private.f(p_id uuid default null) returns void language sql as $$ select 2 $$;'),
  ]);
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('overloads inside the baseline are reviewed history and are not reported', () => {
  const result = checkFunctionSignatures([
    migration('0001_baseline.sql', `${BASELINE.sql}\ncreate function kc_private.f(p_id uuid, p_actor uuid) returns void language sql as $$ select 1 $$;`),
  ]);
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('a create inside a comment is ignored', () => {
  const result = checkFunctionSignatures([
    BASELINE,
    migration('0002_note.sql', '-- create function kc_private.f(p_id text) was the old plan\n/* create function kc_private.f(bigint) */ select 1;'),
  ]);
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('pending next-NN files replay after the numbered ones, in their own order', () => {
  assert.deepEqual(
    migrationOrder(['next-10_b.sql', '0002_a.sql', 'next-2_a.sql', '0001_baseline.sql', 'README.md']),
    ['0001_baseline.sql', '0002_a.sql', 'next-2_a.sql', 'next-10_b.sql'],
  );
});

test('the signature ignores names, defaults, OUT parameters and type modifiers', () => {
  assert.equal(signatureOf('p_id uuid, out o_total bigint, p_amount numeric(10,2) default 0'), 'uuid,numeric');
  assert.equal(signatureOf('inout p_n int, variadic p_ids uuid[]'), 'integer,uuid[]');
  assert.equal(signatureOf('double precision, public.post_status'), 'double precision,post_status');
  assert.equal(signatureOf(''), '');
});

test('statements keep file order, so a drop after the create does not excuse it', () => {
  const sql = 'create function kc_private.f(p_id text) returns void language sql as $$ select 1 $$;\ndrop function kc_private.f(uuid);';
  assert.deepEqual(functionStatements(sql).map((s) => s.kind), ['create', 'drop']);
  const result = checkFunctionSignatures([BASELINE, migration('0002_late_drop.sql', sql)]);
  assert.equal(result.ok, false);
});

test('blanking comments keeps every offset and line', () => {
  const sql = 'a -- note\n/* two\nlines */ b';
  const blank = blankComments(sql);
  assert.equal(blank.length, sql.length);
  assert.equal(blank.split('\n').length, sql.split('\n').length);
  assert.ok(!blank.includes('note'));
});
