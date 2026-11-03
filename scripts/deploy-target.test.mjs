// Unit tests for scripts/deploy-target.mjs. Run: node --test scripts/deploy-target.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BUMP_IDENTITY,
  BUMP_SUBJECT,
  bumpCommitErrors,
  chooseDeploy,
  findGatedRun,
  findReleasePr,
  resolveTarget,
} from './deploy-target.mjs';

const SHA = 'a'.repeat(40);
const RUN_SHA = 'b'.repeat(40);
const REPO = 'KarmaCummunity/KC';
const pushRun = (branch, path = '.github/workflows/ci.yml') => ({
  event: 'push',
  conclusion: 'success',
  head_branch: branch,
  head_sha: RUN_SHA,
  head_repository: { full_name: REPO },
  path,
});

test('a successful dev push CI run deploys its own head SHA to dev', () => {
  const r = resolveTarget({ event: 'workflow_run', ref: 'refs/heads/main', repo: REPO, sha: SHA, workflowRun: pushRun('dev') });
  assert.deepEqual(r, { branch: 'dev', sha: RUN_SHA, target: 'dev', trigger: 'ci' });
});

test('main maps to prod', () => {
  assert.equal(resolveTarget({ event: 'workflow_run', ref: 'refs/heads/main', repo: REPO, sha: SHA, workflowRun: pushRun('main') }).target, 'prod');
});

test('PR-event or failed CI runs never deploy', () => {
  const pr = { ...pushRun('dev'), event: 'pull_request' };
  assert.throws(() => resolveTarget({ event: 'workflow_run', ref: 'refs/heads/main', workflowRun: pr }), /only successful pushes deploy/);
  const failed = { ...pushRun('dev'), conclusion: 'failure' };
  assert.throws(() => resolveTarget({ event: 'workflow_run', ref: 'refs/heads/main', workflowRun: failed }), /only successful pushes/);
});

test('a dispatch deploys the dispatched ref SHA, from dev or main only', () => {
  assert.deepEqual(resolveTarget({ event: 'workflow_dispatch', ref: 'refs/heads/main', sha: SHA }), {
    branch: 'main',
    sha: SHA,
    target: 'prod',
    trigger: 'dispatch',
  });
  assert.throws(() => resolveTarget({ event: 'workflow_dispatch', ref: 'refs/heads/feat/x', sha: SHA }), /only dev and main deploy/);
  assert.throws(() => resolveTarget({ event: 'workflow_dispatch', ref: 'refs/tags/main', sha: SHA }), /only dev and main deploy/);
});

test('other events and malformed SHAs are refused', () => {
  assert.throws(() => resolveTarget({ event: 'push', ref: 'refs/heads/main', sha: SHA }), /only dev deploys on push/);
  assert.throws(() => resolveTarget({ event: 'pull_request', ref: 'refs/heads/dev', sha: SHA }), /cannot run on pull_request/);
  assert.deepEqual(resolveTarget({ event: 'push', ref: 'refs/heads/dev', sha: SHA }), { branch: 'dev', sha: SHA, target: 'dev', trigger: 'dispatch' });
  assert.throws(() => resolveTarget({ event: 'workflow_dispatch', ref: 'refs/heads/dev', sha: 'abc' }), /not a commit SHA/);
});

test('findGatedRun needs a successful push run whose CI gate job succeeded', async () => {
  const jobs = {
    1: [{ name: 'CI gate', conclusion: 'success' }],
    2: [{ name: 'CI gate', conclusion: 'failure' }],
    3: [{ name: 'frontend / quality', conclusion: 'success' }],
  };
  const jobsOf = async (id) => jobs[id];
  const run = (id, extra = {}) => ({ id, event: 'push', conclusion: 'success', ...extra });
  assert.equal(await findGatedRun([run(3), run(1)], jobsOf), 1);
  assert.equal(await findGatedRun([run(2), run(3)], jobsOf), null);
  assert.equal(await findGatedRun([run(1, { event: 'pull_request' })], jobsOf), null);
  assert.equal(await findGatedRun([run(1, { conclusion: 'failure' })], jobsOf), null);
  assert.equal(await findGatedRun([], jobsOf), null);
});

test('a CI run from another repository never deploys', () => {
  const forked = { ...pushRun('main'), head_repository: { full_name: 'evil/KC' } };
  assert.throws(() => resolveTarget({ event: 'workflow_run', ref: 'refs/heads/main', repo: REPO, workflowRun: forked }), /came from evil\/KC/);
});

test('findReleasePr needs a merged dev → main PR of this repo whose merge commit is the SHA', () => {
  const pr = {
    number: 7,
    merged_at: '2026-10-30T00:00:00Z',
    merge_commit_sha: SHA,
    base: { ref: 'main', repo: { full_name: REPO } },
    head: { ref: 'dev', repo: { full_name: REPO } },
  };
  assert.equal(findReleasePr([pr], { repo: REPO, sha: SHA }), 7);
  assert.equal(findReleasePr([{ ...pr, merged_at: null }], { repo: REPO, sha: SHA }), null);
  assert.equal(findReleasePr([{ ...pr, merge_commit_sha: RUN_SHA }], { repo: REPO, sha: SHA }), null);
  assert.equal(findReleasePr([{ ...pr, head: { ref: 'feat/x', repo: { full_name: REPO } } }], { repo: REPO, sha: SHA }), null);
  assert.equal(findReleasePr([{ ...pr, head: { ref: 'dev', repo: { full_name: 'fork/KC' } } }], { repo: REPO, sha: SHA }), null);
  assert.equal(findReleasePr([], { repo: REPO, sha: SHA }), null);
});

// ── Version-bump inheritance (TD-231) ──────────────────────────────────────

const MERGE = 'c'.repeat(40); // the green merge commit (judged SHA)
const BUMP = 'd'.repeat(40); // its [skip ci] bump child (dev tip)
const OTHER = 'e'.repeat(40);
const bot = { ...BUMP_IDENTITY, date: '2026-10-31T00:00:00Z' };
const human = { name: 'Some One', email: 'someone@example.com' };

/** A GET /commits/{sha} payload; the default is a well-formed bump commit of MERGE. */
const commitPayload = ({ sha = BUMP, parents = [MERGE], files = ['app/VERSION'], author = bot, committer = bot, message } = {}) => ({
  sha,
  parents: parents.map((p) => ({ sha: p })),
  files: files.map((filename) => ({ filename })),
  commit: { author, committer, message: message ?? `${BUMP_SUBJECT} to 1.4.3 [skip ci]` },
});

/** Injected API: `commits` by SHA, `gated` = SHAs with a green CI gate (on `gatedBranch`). */
function deps({ commits = {}, gated = [], gatedBranch = 'dev' } = {}) {
  const calls = [];
  return {
    calls,
    commitOf: async (sha) => commits[sha] ?? commitPayload({ sha, parents: [OTHER], files: ['app/x.ts'], author: human, committer: human, message: 'feat: x' }),
    gatedRunOf: async (sha, branches) => {
      calls.push({ sha, branches: branches ? [...branches] : null });
      if (!gated.includes(sha)) return null;
      return branches && !branches.has(gatedBranch) ? null : 42;
    },
  };
}

test('bumpCommitErrors accepts exactly the bump workflow commit shape', () => {
  assert.deepEqual(bumpCommitErrors(commitPayload()), []);
  // The author alone, or the committer alone, being the bot is enough.
  assert.deepEqual(bumpCommitErrors(commitPayload({ committer: human })), []);
  assert.deepEqual(bumpCommitErrors(commitPayload({ author: human })), []);
});

test('bumpCommitErrors rejects every other shape', () => {
  assert.match(bumpCommitErrors(commitPayload({ files: ['app/VERSION', 'app/x.ts'] })).join(), /not only app\/VERSION/);
  assert.match(bumpCommitErrors(commitPayload({ files: ['app/x.ts'] })).join(), /not only app\/VERSION/);
  assert.match(bumpCommitErrors(commitPayload({ files: [] })).join(), /no files/);
  assert.match(bumpCommitErrors(commitPayload({ author: human, committer: human })).join(), /not the bump workflow/);
  // Name or email alone does not make the bot identity.
  assert.match(bumpCommitErrors(commitPayload({ author: { ...human, name: BUMP_IDENTITY.name }, committer: human })).join(), /not the bump workflow/);
  assert.match(bumpCommitErrors(commitPayload({ parents: [MERGE, OTHER] })).join(), /2 parents, not 1/);
  assert.match(bumpCommitErrors(commitPayload({ parents: [] })).join(), /0 parents/);
  assert.match(bumpCommitErrors(commitPayload({ message: 'chore: tweak VERSION' })).join(), /subject/);
  assert.ok(bumpCommitErrors(undefined).length > 0);
});

test('bump-version-on-merge.yml still writes the identity and subject deploy-target expects', () => {
  const wf = readFileSync(new URL('../.github/workflows/bump-version-on-merge.yml', import.meta.url), 'utf8');
  assert.ok(wf.includes(`git config user.name "${BUMP_IDENTITY.name}"`));
  assert.ok(wf.includes(`git config user.email "${BUMP_IDENTITY.email}"`));
  assert.ok(wf.includes(`git commit -m "${BUMP_SUBJECT} to `));
});

test('a run of the bump workflow is a bump trigger; any other workflow file is refused', () => {
  const bump = pushRun('dev', '.github/workflows/bump-version-on-merge.yml');
  assert.equal(resolveTarget({ event: 'workflow_run', ref: 'refs/heads/main', repo: REPO, workflowRun: bump }).trigger, 'bump');
  const lookalike = pushRun('dev', '.github/workflows/not-ci.yml');
  assert.throws(() => resolveTarget({ event: 'workflow_run', ref: 'refs/heads/main', repo: REPO, workflowRun: lookalike }), /cannot trigger a deploy/);
});

const base = { sha: MERGE, target: 'dev', branch: 'dev' };

test('CI trigger: the green merge with its bump child on top deploys the bump child, inherited', async () => {
  const d = deps({ commits: { [BUMP]: commitPayload() }, gated: [MERGE] });
  const r = await chooseDeploy({ ...base, tip: BUMP, trigger: 'ci' }, d);
  assert.deepEqual(r, { deploy: true, sha: BUMP, runId: 42, inheritedFrom: MERGE });
  // The parent's run must be on dev or main.
  assert.deepEqual(d.calls.at(-1).branches.sort(), ['dev', 'main']);
});

test('CI trigger: the merge still the tip (bump not landed yet) deploys the merge itself', async () => {
  assert.deepEqual(await chooseDeploy({ ...base, tip: MERGE, trigger: 'ci' }, deps({ gated: [MERGE] })), { deploy: true, sha: MERGE, runId: 42 });
});

test('the parent CI run must be on dev or main to certify a bump', async () => {
  const d = deps({ commits: { [BUMP]: commitPayload() }, gated: [MERGE], gatedBranch: 'feat/x' });
  await assert.rejects(chooseDeploy({ ...base, tip: BUMP, trigger: 'ci' }, d), /cannot inherit/);
});

test('rejected bump shapes on the tip are "moved on", never deployed', async () => {
  const shapes = {
    'two files': commitPayload({ files: ['app/VERSION', 'app/x.ts'] }),
    'non-bot author': commitPayload({ author: human, committer: human }),
    'merge commit': commitPayload({ parents: [MERGE, OTHER] }),
    'child of another commit': commitPayload({ parents: [OTHER] }),
  };
  for (const [name, child] of Object.entries(shapes)) {
    const r = await chooseDeploy({ ...base, tip: BUMP, trigger: 'ci' }, deps({ commits: { [BUMP]: child }, gated: [MERGE] }));
    assert.equal(r.deploy, false, name);
    assert.match(r.reason, /has moved on/, name);
  }
});

test('a red parent never certifies its bump child', async () => {
  const d = () => deps({ commits: { [BUMP]: commitPayload() }, gated: [] });
  await assert.rejects(chooseDeploy({ ...base, tip: BUMP, trigger: 'ci' }, d()), /cannot inherit/);
  await assert.rejects(chooseDeploy({ ...base, tip: BUMP, trigger: 'dispatch' }, d()), /cannot inherit/);
  // From the bump trigger it is the normal "CI still running" case: skip.
  const r = await chooseDeploy({ ...base, tip: BUMP, trigger: 'bump' }, d());
  assert.equal(r.deploy, false);
  assert.match(r.reason, /its CI run's completion deploys/);
});

test('bump trigger: deploys the bump child once the merge is green, never the merge itself', async () => {
  const d = deps({ commits: { [BUMP]: commitPayload() }, gated: [MERGE] });
  assert.deepEqual(await chooseDeploy({ ...base, tip: BUMP, trigger: 'bump' }, d), { deploy: true, sha: BUMP, runId: 42, inheritedFrom: MERGE });
  const still = await chooseDeploy({ ...base, tip: MERGE, trigger: 'bump' }, deps({ gated: [MERGE] }));
  assert.equal(still.deploy, false);
  assert.match(still.reason, /its own CI run deploys it/);
});

test('dispatch on a bump tip deploys it on the parent; an ungated non-bump tip is refused', async () => {
  const d = deps({ commits: { [BUMP]: commitPayload() }, gated: [MERGE] });
  assert.deepEqual(await chooseDeploy({ ...base, sha: BUMP, tip: BUMP, trigger: 'dispatch' }, d), {
    deploy: true,
    sha: BUMP,
    runId: 42,
    inheritedFrom: MERGE,
  });
  await assert.rejects(chooseDeploy({ ...base, sha: OTHER, tip: OTHER, trigger: 'dispatch' }, deps()), /not a certified version bump/);
});

test('prod never inherits: an ungated main tip is refused and a newer main tip is "moved on"', async () => {
  const d = () => deps({ commits: { [BUMP]: commitPayload() }, gated: [MERGE] });
  const prod = { ...base, target: 'prod', branch: 'main' };
  await assert.rejects(chooseDeploy({ ...prod, sha: BUMP, tip: BUMP, trigger: 'dispatch' }, d()), /refusing to deploy/);
  const r = await chooseDeploy({ ...prod, tip: BUMP, trigger: 'ci' }, d());
  assert.equal(r.deploy, false);
  assert.match(r.reason, /has moved on/);
});

test('findGatedRun with branches counts only runs on those branches', async () => {
  const jobsOf = async () => [{ name: 'CI gate', conclusion: 'success' }];
  const run = { id: 9, event: 'push', conclusion: 'success', head_branch: 'feat/x' };
  assert.equal(await findGatedRun([run], jobsOf, new Set(['dev', 'main'])), null);
  assert.equal(await findGatedRun([{ ...run, head_branch: 'dev' }], jobsOf, new Set(['dev', 'main'])), 9);
});
