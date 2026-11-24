import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import {
  deployVerdict, freezePlan, isCiSkipped, judgeChecks, latestByName, migrationChanges,
  nextPatch, releaseHeadPlan, renderSummary, scanMigrationSql, skipDecision, sqlStatements, RELEASE_E2E_CHECK,
} from './release-train-lib.mjs';

test('nextPatch bumps PATCH and rejects junk', () => {
  assert.equal(nextPatch('1.9.143\n'), '1.9.144');
  assert.throws(() => nextPatch('1.9'), /MAJOR.MINOR.PATCH/);
});

test('isCiSkipped matches the bump commits', () => {
  assert.equal(isCiSkipped('chore(release): bump app version to 1.9.143 [skip ci]'), true);
  assert.equal(isCiSkipped('feat: thing (#1)'), false);
});

test('skipDecision', () => {
  assert.equal(skipDecision({ ahead_by: 0, files: [] }).skip, true);
  assert.equal(skipDecision({ ahead_by: 3, files: [] }).skip, true, 'sync/bump commits only');
  assert.equal(skipDecision({ ahead_by: 1, files: [{ filename: 'app/VERSION' }] }).skip, true);
  assert.equal(skipDecision({ ahead_by: 2, files: [{ filename: 'app/VERSION' }, { filename: 'a.ts' }] }).skip, false);
});

test('sqlStatements drops comments, strings and function bodies', () => {
  const st = sqlStatements(`-- DROP TABLE x;\ncreate function f() returns void as $$ begin delete from t; end $$ language plpgsql;\nselect 'truncate t';`);
  assert.equal(st.length, 2);
  assert.ok(!st.some((s) => /drop table|delete from t|truncate t/i.test(s)));
});

test('scanMigrationSql flags destructive statements', () => {
  const rules = (sql) => scanMigrationSql('x.sql', sql).map((f) => f.rule);
  assert.deepEqual(rules('DROP TABLE public.a;'), ['drop-table']);
  assert.deepEqual(rules('drop schema s cascade;'), ['drop-schema']);
  assert.deepEqual(rules('ALTER TABLE a DROP COLUMN b;'), ['drop-column']);
  assert.deepEqual(rules('alter table a drop b;'), ['drop-column']);
  assert.deepEqual(rules('ALTER TABLE a ALTER COLUMN b TYPE text;'), ['alter-column-type']);
  assert.deepEqual(rules('ALTER TABLE a RENAME TO b;'), ['rename']);
  assert.deepEqual(rules('TRUNCATE a;'), ['truncate']);
  assert.deepEqual(rules('DELETE FROM a;'), ['delete-without-where']);
  assert.deepEqual(rules('DELETE FROM a\n  WHERE id = 1;'), []);
  assert.deepEqual(rules('UPDATE a SET b = 1;'), ['update-without-where']);
  assert.deepEqual(rules('UPDATE a SET b = 1 WHERE c;'), []);
  assert.deepEqual(rules('DROP TABLE a; -- migration-safety: allow'), ['drop-table'], 'the train ignores allow markers');
});

test('scanMigrationSql leaves additive / reversible DDL alone', () => {
  const sql = `
    create table if not exists a (id int);
    alter table a add column b text;
    alter table a alter column b drop not null;
    alter table a alter column b drop default;
    alter table a drop constraint a_pk;
    drop index if exists a_idx;
    drop policy if exists p on a;
    drop function if exists f();
    drop view if exists v;
    drop trigger if exists t on a;
    create or replace function f() returns void language sql as $$ delete from a $$;
    insert into a values (1);`;
  assert.deepEqual(scanMigrationSql('ok.sql', sql), []);
});

test('migrationChanges: new files scanned, edited/deleted ones stop', () => {
  const r = migrationChanges('A\tsupabase/migrations/0070_x.sql\nM\tsupabase/migrations/0001_baseline.sql\nD\tsupabase/migrations/0002.sql\nA\tsupabase/migrations/README.md');
  assert.deepEqual(r.added, ['supabase/migrations/0070_x.sql']);
  assert.deepEqual(r.problems.map((p) => p.file), ['supabase/migrations/0001_baseline.sql', 'supabase/migrations/0002.sql']);
});

const run = (id, name, status, conclusion) => ({ id, name, status, conclusion });
const green = [run(1, 'CI gate', 'completed', 'success'), run(2, 'CI verdict', 'completed', 'success'), run(3, RELEASE_E2E_CHECK, 'completed', 'success')];

test('latestByName keeps the newest run', () => {
  assert.equal(latestByName([run(1, 'a', 'completed', 'failure'), run(5, 'a', 'completed', 'success')]).get('a').conclusion, 'success');
});

test('judgeChecks success / pending / failure', () => {
  assert.equal(judgeChecks({ checkRuns: green, statuses: [] }).state, 'success');
  assert.equal(judgeChecks({ checkRuns: green.slice(0, 2), statuses: [] }).state, 'pending');
  assert.equal(judgeChecks({ checkRuns: [...green, run(9, 'maestro', 'in_progress', null)], statuses: [] }).state, 'pending');
  const f = judgeChecks({ checkRuns: [...green, run(9, 'frontend / unit', 'completed', 'failure')], statuses: [] });
  assert.equal(f.state, 'failure');
  assert.deepEqual(f.failing, ['frontend / unit: failure']);
  assert.equal(judgeChecks({ checkRuns: [...green, run(9, 'x', 'completed', 'failure'), run(10, 'x', 'completed', 'success')], statuses: [] }).state, 'success', 'a green rerun wins');
  assert.equal(judgeChecks({ checkRuns: green, statuses: [{ context: 'security/snyk (navesarussi)', state: 'failure', updated_at: '1' }] }).state, 'failure');
  assert.equal(judgeChecks({ checkRuns: [...green, run(9, 'approve release', 'completed', 'cancelled')], statuses: [] }).state, 'success');
  assert.equal(judgeChecks({ checkRuns: [...green, run(9, 'x', 'completed', 'skipped')], statuses: [] }).state, 'success');
});

test('freezePlan', () => {
  const prs = [
    { number: 1, autoMergeRequest: { enabledAt: 'x' }, isInMergeQueue: false, labels: [] },
    { number: 2, autoMergeRequest: null, isInMergeQueue: true, labels: ['no-auto-merge'] },
    { number: 3, autoMergeRequest: null, isInMergeQueue: false, labels: ['no-auto-merge'] },
    { number: 4, autoMergeRequest: null, isInMergeQueue: false, labels: [] },
    { number: 5, autoMergeRequest: { enabledAt: 'x' }, isInMergeQueue: true, labels: [] },
  ];
  assert.deepEqual(freezePlan(prs, [5]), [
    { number: 1, armed: true, queued: false, addLabel: true },
    { number: 2, armed: false, queued: true, addLabel: false },
  ]);
});

const job = (name, conclusion) => ({ name, conclusion });
const okJobs = [
  job('database / backup (prod)', 'success'), job('database / migrations · prod', 'success'),
  job('edge functions / functions · prod', 'success'), job('web / web · prod', 'success'),
  job('smoke / smoke · prod', 'success'), job('tag release / tag release', 'success'),
];

test('deployVerdict', () => {
  assert.equal(deployVerdict(okJobs).ok, true);
  assert.equal(deployVerdict(okJobs).rollback, 'not run');
  const bad = deployVerdict([...okJobs.slice(0, 4), job('smoke / smoke · prod', 'failure'), job('tag release / tag release', 'skipped'),
    job('rollback (prod) / rollback web', 'success'), job('rollback (prod) / rollback report', 'failure')]);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.problems, ['smoke: failure', 'tag: skipped']);
  assert.match(bad.rollback, /rollback web: success/);
  assert.deepEqual(deployVerdict(okJobs.slice(1)).problems, ['backup: missing']);
});

test('renderSummary', () => {
  const md = renderSummary({ outcome: 'aborted', reason: 'Stopped', steps: [{ name: 'checks', result: 'failure', detail: 'a | b' }], findings: [{ file: 'f.sql', what: 'DROP TABLE', statement: 'DROP TABLE a' }], frozen: [7] });
  assert.match(md, /🛑 aborted/);
  assert.match(md, /a \\\| b/);
  assert.match(md, /`f.sql` DROP TABLE/);
  assert.match(md, /#7/);
});

// The workflow itself: schedule, kill switch, secrets only in the one job, pinned actions.
test('release-train.yml guards', () => {
  const text = readFileSync(new URL('../.github/workflows/release-train.yml', import.meta.url), 'utf8');
  const wf = parse(text);
  assert.ok(wf.on.schedule?.length === 1, 'weekly schedule');
  assert.equal(wf.on.workflow_dispatch.inputs.dry_run.default, true, 'dispatch defaults to a dry run');
  assert.equal(wf.concurrency['cancel-in-progress'], false);
  assert.deepEqual(wf.on.push.branches, ['dev'], 'push runs only on dev');
  const dry = wf.jobs.train.env.DRY_RUN;
  assert.match(dry, /github\.event_name == 'schedule' \|\| \(github\.event_name == 'workflow_dispatch' && !inputs\.dry_run\)\) && 'false' \|\| 'true'/, 'real only on schedule / unticked dispatch');
  assert.deepEqual(Object.keys(wf.permissions), ['contents']);
  for (const [id, j] of Object.entries(wf.jobs)) {
    assert.ok(j['timeout-minutes'] > 0, `${id} has a timeout`);
    const usesSecrets = JSON.stringify(j).includes('secrets.');
    if (usesSecrets) assert.equal(j.environment, 'release-train', `${id}: train secrets live only on the release-train environment`);
  }
  for (const m of text.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)) {
    if (m[1].startsWith('./')) continue;
    assert.match(m[1], /@[0-9a-f]{40}$/, `${m[1]} pinned by SHA`);
  }
  assert.ok(!/secrets:\s*inherit/.test(text));
  assert.ok(!/environment:\s*production/.test(text), 'never holds the production environment itself');
});

test('release PR body carries justifications that pass the strict release scan (DROP FUNCTION)', async () => {
  const { checkReleaseMigrations } = await import('./check-migration-safety.mjs');
  const { migrationSafetyLines } = await import('./release-train-lib.mjs');
  const files = [{ name: '0999_replace_fn.sql', content: 'drop function kc_private.f(integer);\n' }];
  assert.ok(checkReleaseMigrations(files, '').length > 0, 'unjustified drop fails the strict scan');
  const lines = migrationSafetyLines([
    '# notes', '    Migration safety: <file name ending in sql> — <why>',
    'Migration safety: 0999_replace_fn.sql — only the scheduled job calls it, no client grant.',
  ].join('\n'));
  assert.equal(lines.length, 1, 'prose and the format example are not copied');
  assert.deepEqual(checkReleaseMigrations(files, ['Summary', ...lines].join('\n')), []);
  assert.ok(checkReleaseMigrations(files, 'Migration safety: 0998_other.sql — unrelated reason here').length > 0, 'justification is per file');
});

// #2613: versions move at release time; the train opens the version PR when dev is not ahead of the latest tag.
test('releaseHeadPlan: ahead + CI-run tip releases as is; not ahead or [skip ci] → version PR; unreadable tags throw', () => {
  const tags = ['v1.9.289', 'v1.9.290', 'mobile/ios/v1.9.295-b43'];
  assert.deepEqual(
    (({ needsVersionPr, version }) => ({ needsVersionPr, version }))(releaseHeadPlan({ current: '1.9.291\n', tipMessage: 'feat: x (#1)', tags })),
    { needsVersionPr: false, version: '1.9.291' },
  );
  const notAhead = releaseHeadPlan({ current: '1.9.290\n', tipMessage: 'feat: x (#1)', tags });
  assert.equal(notAhead.needsVersionPr, true);
  assert.equal(notAhead.version, '1.9.291');
  assert.match(notAhead.why, /not ahead of the released v1\.9\.290/);
  const skipped = releaseHeadPlan({ current: '1.9.291', tipMessage: 'chore: x [skip ci]', tags });
  assert.deepEqual([skipped.needsVersionPr, skipped.version], [true, '1.9.292']);
  assert.throws(() => releaseHeadPlan({ current: '1.9.291', tipMessage: 'feat', tags: null }), /release tags are required/);
});
