// Unit tests for scripts/ci-verdict.mjs. Run: node --test scripts/ci-verdict.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATE_JOB, VERDICT_CHECK, decide, gateJobErrors, judgeRun, verdictCheck } from './ci-verdict.mjs';

const REPO = 'Org/KC';
const HEAD = 'h'.repeat(40);
const MERGE = 'm'.repeat(40);
const BASE = 'b'.repeat(40);
const TIP = 't'.repeat(40);
const ENV = { GITHUB_TOKEN: 't', RUN_ID: '1', HEAD_SHA: HEAD };
const ok = (name, run_attempt = 1) => ({ name, run_attempt, status: 'completed', conclusion: 'success' });

function prRun(overrides = {}) {
  return {
    id: 1,
    run_attempt: 1,
    event: 'pull_request',
    status: 'completed',
    conclusion: 'success',
    created_at: '2026-10-30T10:00:00Z',
    path: '.github/workflows/ci.yml',
    head_sha: HEAD,
    head_branch: 'feat/x',
    html_url: 'https://github.com/Org/KC/actions/runs/1',
    repository: { full_name: REPO },
    head_repository: { full_name: REPO },
    referenced_workflows: [{ path: `${REPO}/.github/workflows/ci-static-guards.yml@refs/pull/7/merge`, sha: MERGE, ref: 'refs/pull/7/merge' }],
    ...overrides,
  };
}

/** Serve the API a verdict needs: run 1 is `run`, PR #7 targets `baseRef`. */
async function withApi({ run = prRun(), baseRef = 'dev', jobs = [ok('detect changes'), ok(GATE_JOB)], runs = [run], siblings } = {}, fn) {
  const pr = { number: 7, base: { ref: baseRef, repo: { full_name: REPO } }, head: { ref: 'feat/x', sha: HEAD, repo: { full_name: REPO } } };
  const routes = {
    [`/repos/${REPO}/actions/runs/1`]: run,
    [`/repos/${REPO}/actions/workflows/ci.yml/runs`]: { workflow_runs: runs },
    [`/repos/${REPO}/pulls/7`]: pr,
    [`/repos/${REPO}/pulls`]: siblings ?? [pr],
    [`/repos/${REPO}/commits/${MERGE}`]: { parents: [{ sha: BASE }, { sha: HEAD }] },
    [`/repos/${REPO}/branches/${baseRef}`]: { commit: { sha: TIP } },
    [`/repos/${REPO}/compare/${BASE}...${TIP}`]: { status: 'identical', files: [] },
    [`/repos/${REPO}/actions/runs/1/jobs`]: { jobs },
  };
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    return path in routes ? { ok: true, json: async () => routes[path] } : { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

test('gateJobErrors needs exactly one successful CI gate job', () => {
  assert.deepEqual(gateJobErrors([ok(GATE_JOB)]), []);
  assert.match(gateJobErrors([])[0], /0 "CI gate" jobs/);
  assert.match(gateJobErrors([ok(GATE_JOB), ok(GATE_JOB)])[0], /2 "CI gate" jobs/);
  assert.match(gateJobErrors([{ name: GATE_JOB, status: 'completed', conclusion: 'failure' }])[0], /ended failure/);
});

test('a bound, green, newest PR run into dev certifies its head SHA', async () => {
  assert.deepEqual(await withApi({}, () => judgeRun(prRun(), REPO, ENV)), []);
});

test('a green CI gate from a PR into another branch is not certified', async () => {
  const errors = await withApi({ baseRef: 'attacker' }, () => judgeRun(prRun(), REPO, ENV));
  assert.ok(errors.some((e) => /not dev or main/.test(e)), errors.join('\n'));
});

test('a forged run on another branch that references PR #7 merge ref is not certified', async () => {
  const forged = prRun({ head_branch: 'attack-branch' });
  const errors = await withApi({ run: forged }, () => judgeRun(forged, REPO, ENV));
  assert.ok(errors.some((e) => /but the run built attack-branch/.test(e)), errors.join('\n'));
});

test('failed or cancelled CI runs get a red verdict', async () => {
  const failed = await withApi({ jobs: [{ ...ok(GATE_JOB), conclusion: 'failure' }] }, () => judgeRun(prRun({ conclusion: 'failure' }), REPO, ENV));
  assert.deepEqual(failed, ['CI run concluded failure', '"CI gate" ended failure']);
  const cancelled = await withApi({ jobs: [{ ...ok(GATE_JOB), conclusion: 'cancelled' }] }, () => judgeRun(prRun({ conclusion: 'cancelled' }), REPO, ENV));
  assert.equal(cancelled.length, 2);
});

test('an older run (or a re-run of one) cannot override a newer run on the same SHA', async () => {
  const newer = prRun({ id: 2, created_at: '2026-10-30T11:00:00Z', html_url: 'https://github.com/Org/KC/actions/runs/2' });
  const errors = await withApi({ runs: [prRun(), newer] }, () => judgeRun(prRun(), REPO, ENV));
  assert.ok(errors.some((e) => /newer CI run exists/.test(e)), errors.join('\n'));
});

test('a partial re-run that keeps jobs from an earlier attempt is not certified', async () => {
  const run = prRun({ run_attempt: 2 });
  const errors = await withApi({ run, jobs: [ok('static / test integrity', 1), ok(GATE_JOB, 2)] }, () => judgeRun(run, REPO, ENV));
  assert.ok(errors.some((e) => /earlier attempt/.test(e)), errors.join('\n'));
});

test('a look-alike workflow is rejected without trusting its jobs', async () => {
  const errors = await withApi({}, () => judgeRun(prRun({ path: '.github/workflows/evil.yml' }), REPO, ENV));
  assert.match(errors[0], /not \.github\/workflows\/ci\.yml/);
});

test('review runs are bound like PR runs', async () => {
  const review = prRun({ event: 'pull_request_review' });
  assert.deepEqual(await withApi({ run: review }, () => judgeRun(review, REPO, ENV)), []);
});

test('decide posts nothing for push runs and a red verdict on any lookup error', async () => {
  assert.equal(await withApi({ run: prRun({ event: 'push', head_branch: 'dev' }) }, () => decide(ENV, REPO)), null);
  const lost = await withApi({}, () => decide({ ...ENV, RUN_ID: '404' }, REPO));
  assert.equal(lost.conclusion, 'failure');
  assert.equal(lost.head_sha, HEAD);
  assert.match(lost.output.summary, /verification failed/);
  const green = await withApi({}, () => decide(ENV, REPO));
  assert.equal(green.conclusion, 'success');
});

test('decide refuses a run whose head differs from the triggering event', async () => {
  const check = await withApi({}, () => decide({ ...ENV, HEAD_SHA: BASE }, REPO));
  assert.equal(check.conclusion, 'failure');
  assert.equal(check.head_sha, BASE);
});

test('verdictCheck posts success only without errors, on the given SHA', () => {
  const green = verdictCheck(HEAD, 'u', []);
  assert.equal(green.name, VERDICT_CHECK);
  assert.equal(green.head_sha, HEAD);
  assert.equal(green.conclusion, 'success');
  const red = verdictCheck(HEAD, undefined, ['nope']);
  assert.equal(red.conclusion, 'failure');
  assert.match(red.output.summary, /- nope/);
  assert.equal('details_url' in red, false);
});

test('the committed rulesets: CI verdict from its own App, CI gate from Actions, no bypass, no dev/main tags', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const read = (name) => JSON.parse(readFileSync(join(root, '.github/rulesets', name), 'utf8'));
  const ruleset = read('dev-main.json');
  assert.deepEqual(ruleset.bypass_actors, []);
  const checks = ruleset.rules.find((r) => r.type === 'required_status_checks').parameters.required_status_checks;
  const verdict = checks.find((c) => c.context === VERDICT_CHECK);
  assert.ok(verdict, 'CI verdict must be required');
  assert.notEqual(verdict.integration_id, 15368, 'CI verdict must come from the CI-verdict App, not GitHub Actions');
  assert.equal(checks.find((c) => c.context === GATE_JOB)?.integration_id, 15368);
  const tags = read('tags-no-branch-names.json');
  assert.equal(tags.target, 'tag');
  assert.deepEqual(tags.conditions.ref_name.include.sort(), ['refs/tags/dev', 'refs/tags/main']);
  assert.deepEqual(tags.bypass_actors, []);
  assert.ok(tags.rules.some((r) => r.type === 'creation'));
});
