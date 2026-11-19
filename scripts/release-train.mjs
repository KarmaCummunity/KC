#!/usr/bin/env node
// Weekly release train: dev → main → production → TestFlight / Play internal,
// with no human click (owner decision, 16 Nov 2026). Driven step by step by
// .github/workflows/release-train.yml; design and failure handling in
// docs/release/WEEKLY-RELEASE-TRAIN.md. Every rule that can stop the train
// lives in scripts/release-train-lib.mjs and is unit-tested.
//
//   node scripts/release-train.mjs <step>
//   steps: plan | freeze | head | open-pr | wait | merge | deploy | sync | unfreeze | stores | report
//
// State is a JSON file ($TRAIN_STATE) that each step reads and extends, so
// the always() steps (unfreeze, report) know what happened before them.
//
// Tokens (never printed; only passed in request headers):
//   OPERATOR_TOKEN  KC_RELEASE_TRAIN_TOKEN — karma-community-kc (repo admin):
//                   branches, PRs, auto-merge, the release merge, the sync merge
//                   and the two repo-setting toggles around them.
//   APPROVER_TOKEN  KC_RELEASE_TRAIN_APPROVER_TOKEN — a `production` reviewer;
//                   used for exactly one call: approving the Deploy run.
//   GITHUB_TOKEN    the workflow token: reads, and the optional issue comment.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  FREEZE_LABEL, TRAIN_LABELS, deployVerdict, freezePlan, isCiSkipped, judgeChecks,
  migrationChanges, nextPatch, renderSummary, scanMigrationSql, skipDecision,
} from './release-train-lib.mjs';
import { preservationPreflight } from './release-preservation.mjs';
import { RELEASE_SUBJECT, releasePrProblems, releaseSquashMessage } from './release-merge.mjs';

const REPO = process.env.GITHUB_REPOSITORY || 'KarmaCummunity/KC';
const [OWNER, NAME] = REPO.split('/');
const API = process.env.GITHUB_API_URL || 'https://api.github.com';
const RUN_URL = `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID || 'local'}`;
const STATE = process.env.TRAIN_STATE || 'release-train-state.json';
const DRY = process.env.DRY_RUN === 'true';
const MIN = 60_000;
const minutes = (name, dflt) => Number(process.env[name] || dflt);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(msg);

// ---------------------------------------------------------------------------
// GitHub API
// ---------------------------------------------------------------------------
const TOKENS = { operator: 'OPERATOR_TOKEN', approver: 'APPROVER_TOKEN', workflow: 'GITHUB_TOKEN' };
function token(kind) {
  const t = process.env[TOKENS[kind]]?.trim();
  if (!t) throw new Error(`${TOKENS[kind]} is not set`);
  return t;
}

async function api(kind, method, path, body, { allow = [] } = {}) {
  const url = path.startsWith('http') ? path : `${API}/${path.replace(/^\//, '')}`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token(kind)}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status >= 500 && attempt < 4) { await sleep(attempt * 5000); continue; }
    const text = await res.text();
    const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
    if (!res.ok && !allow.includes(res.status)) {
      const err = new Error(`${method} ${url.replace(API, '')} → HTTP ${res.status}: ${data?.message ?? String(text).slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    return { status: res.status, data };
  }
}
const get = async (kind, path, opts) => (await api(kind, 'GET', path, null, opts)).data;
async function list(kind, path, key) {
  const out = [];
  for (let page = 1; page < 50; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const data = await get(kind, `${path}${sep}per_page=100&page=${page}`);
    const items = key ? data[key] : data;
    out.push(...items);
    if (items.length < 100) break;
  }
  return out;
}
async function gql(kind, query, variables) {
  const { data } = await api(kind, 'POST', 'graphql', { query, variables });
  if (data.errors?.length) throw new Error(`GraphQL: ${data.errors.map((e) => e.message).join('; ')}`);
  return data.data;
}
const repoPath = (p) => `repos/${REPO}/${p}`;

// ---------------------------------------------------------------------------
// State, steps, outputs
// ---------------------------------------------------------------------------
function load() {
  return existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { steps: [], dry_run: DRY, run_url: RUN_URL, started_at: new Date().toISOString() };
}
function save(s) { writeFileSync(STATE, JSON.stringify(s, null, 2)); }
function step(s, name, result, detail) {
  s.steps = (s.steps ?? []).filter((x) => x.name !== name);
  s.steps.push({ name, result, ...(detail ? { detail } : {}), at: new Date().toISOString() });
  save(s);
  log(`${result.toUpperCase()}: ${name}${detail ? ` — ${detail}` : ''}`);
}
function output(key, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}
class Abort extends Error {}
function abort(s, name, reason) {
  step(s, name, 'failure', reason);
  s.outcome = 'aborted';
  s.reason = `Stopped at "${name}": ${reason}`;
  save(s);
  throw new Abort(s.reason);
}
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

// Reads pinned Git objects only. Fetch failures, missing blobs and API/ref drift
// abort before the next write. A saved state file is never a substitute for this.
async function preservation(s, target, { main = s.main_sha, dev = target } = {}) {
  const caller = process.env.GITHUB_WORKFLOW_SHA;
  const [currentMain, currentDev] = await Promise.all([
    get('workflow', repoPath('commits/main')), get('workflow', repoPath('commits/dev')),
  ]);
  if (currentMain.sha !== main || currentDev.sha !== dev) throw new Error('preservation: main/dev moved; re-plan required');
  for (const sha of new Set([caller, main, target])) {
    if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error('preservation: immutable SHA unavailable');
    git('fetch', '--no-tags', 'origin', sha);
  }
  s.preservation = preservationPreflight({ caller, target });
  save(s);
  step(s, 'Vault preservation', 'success', `caller ${caller}; target ${target}`);
}

// ---------------------------------------------------------------------------
// plan — every read-only check; the whole of a dry run
// ---------------------------------------------------------------------------
async function plan(s) {
  const blockers = [];
  if (!DRY && process.env.GITHUB_REF !== 'refs/heads/main') blockers.push(['runs from main', `a real train runs only from main's copy (this is ${process.env.GITHUB_REF})`]);
  const enabled = process.env.KC_WEEKLY_RELEASE_ENABLED === 'true';
  s.enabled = enabled;
  if (!DRY && !enabled) {
    s.outcome = 'skipped';
    s.reason = 'Kill switch: repo variable KC_WEEKLY_RELEASE_ENABLED is not "true".';
    step(s, 'kill switch', 'skipped', s.reason);
    return output('proceed', 'false');
  }
  step(s, 'kill switch', enabled ? 'success' : 'skipped', `KC_WEEKLY_RELEASE_ENABLED=${process.env.KC_WEEKLY_RELEASE_ENABLED || '(unset)'}`);

  // 1. Anything to release?
  s.dev_sha = (await get('workflow', repoPath('commits/dev'))).sha;
  s.main_sha = (await get('workflow', repoPath('commits/main'))).sha;
  await preservation(s, s.dev_sha);
  const compare = await get('workflow', repoPath(`compare/${s.main_sha}...${s.dev_sha}`));
  const decision = skipDecision(compare);
  s.ahead_by = compare.ahead_by;
  if (decision.skip) {
    s.outcome = 'skipped';
    s.reason = `Nothing to release: ${decision.reason}.`;
    step(s, 'new commits on dev', 'skipped', decision.reason);
    return output('proceed', 'false');
  }
  step(s, 'new commits on dev', 'success', `${decision.reason}; ${compare.files?.length ?? '?'} file(s) differ`);

  // 2. No release in flight.
  const openReleases = await get('workflow', repoPath(`pulls?state=open&base=main&head=${OWNER}:dev`));
  if (openReleases.length) blockers.push(['no release PR in flight', `release PR #${openReleases[0].number} is already open (manual release in progress)`]);
  else step(s, 'no release PR in flight', 'success');

  // 3. Migrations: strict scan of main...dev (ignores migration-safety: allow).
  // The workflow's checkout (fetch-depth 0) brings origin/main and origin/dev.
  const { added, problems } = migrationChanges(git('diff', '--name-status', '--no-renames', `${s.main_sha}...${s.dev_sha}`, '--', 'supabase/migrations'));
  const findings = [...problems];
  for (const file of added) findings.push(...scanMigrationSql(file, git('show', `${s.dev_sha}:${file}`)));
  s.migrations = added;
  s.findings = findings;
  if (findings.length) blockers.push(['migration safety', `${findings.length} destructive or irreversible change(s) in ${[...new Set(findings.map((f) => f.file))].join(', ')}`]);
  else step(s, 'migration safety', 'success', added.length ? `${added.length} new migration(s), none destructive: ${added.join(', ')}` : 'no migration changes');

  // 4. A fresh, restore-checked prod backup (db-backup-prod.yml, nightly 01:17 UTC).
  const maxAgeH = minutes('KC_RELEASE_TRAIN_BACKUP_MAX_AGE_HOURS', 30);
  const backups = await get('workflow', repoPath('actions/workflows/db-backup-prod.yml/runs?branch=main&status=success&per_page=1'));
  const last = backups.workflow_runs?.[0];
  const ageH = last ? (Date.now() - Date.parse(last.updated_at)) / 3.6e6 : Infinity;
  if (ageH > maxAgeH) blockers.push(['prod backup', last ? `last green db-backup-prod is ${ageH.toFixed(1)} h old (> ${maxAgeH} h): ${last.html_url}` : 'no green db-backup-prod run found']);
  else step(s, 'prod backup', 'success', `green db-backup-prod ${ageH.toFixed(1)} h ago: ${last.html_url}`);

  // 5. Release head: dev's tip must be a commit real CI ran on.
  const tip = await get('workflow', repoPath(`commits/${s.dev_sha}`));
  const current = git('show', `${s.dev_sha}:app/VERSION`);
  s.needs_version_pr = isCiSkipped(tip.commit.message);
  s.version = s.needs_version_pr ? nextPatch(current) : current.trim();
  step(s, 'release head', 'success', s.needs_version_pr
    ? `dev tip ${s.dev_sha.slice(0, 8)} is a [skip ci] commit → a version-only PR sets ${s.version}`
    : `dev tip ${s.dev_sha.slice(0, 8)} ran CI → release ${s.version} as is`);

  // 6. Tokens: present, the right identity, the right reach (read-only probes).
  const tokenProblems = [];
  if (!process.env.OPERATOR_TOKEN) tokenProblems.push('KC_RELEASE_TRAIN_TOKEN is missing');
  else {
    try {
      const login = (await get('operator', 'user')).login;
      const role = (await get('workflow', repoPath(`collaborators/${login}/permission`))).role_name;
      if (role !== 'admin') tokenProblems.push(`KC_RELEASE_TRAIN_TOKEN user ${login} is ${role}, not admin (needed for the sync merge bypass)`);
      // Administration: read is the probe for the settings toggles; writes cannot be probed without writing.
      const adm = await api('operator', 'GET', repoPath('actions/permissions'), null, { allow: [403, 404] });
      if (adm.status !== 200) tokenProblems.push(`KC_RELEASE_TRAIN_TOKEN (${login}) lacks Administration access (HTTP ${adm.status}); it needs Administration, Contents, Pull requests, Actions: read & write`);
      const contents = await api('operator', 'GET', repoPath('git/ref/heads/dev'), null, { allow: [403, 404] });
      if (contents.status !== 200) tokenProblems.push(`KC_RELEASE_TRAIN_TOKEN (${login}) cannot read contents (HTTP ${contents.status})`);
      s.operator = login;
    } catch (e) { tokenProblems.push(`KC_RELEASE_TRAIN_TOKEN: ${e.message}`); }
  }
  if (!process.env.APPROVER_TOKEN) tokenProblems.push('KC_RELEASE_TRAIN_APPROVER_TOKEN is missing');
  else {
    try {
      const login = (await get('approver', 'user')).login;
      const env = await get('workflow', repoPath('environments/production'));
      const reviewers = (env.protection_rules ?? []).flatMap((r) => r.reviewers ?? []).map((r) => r.reviewer?.login);
      if (!reviewers.includes(login)) tokenProblems.push(`approver ${login} is not a required reviewer of production (${reviewers.join(', ')})`);
      await get('approver', repoPath('actions/runs?per_page=1'));
      s.approver = login;
    } catch (e) { tokenProblems.push(`KC_RELEASE_TRAIN_APPROVER_TOKEN: ${e.message}`); }
  }
  if (tokenProblems.length) blockers.push(['train credentials', tokenProblems.join('; ')]);
  else step(s, 'train credentials', 'success', `operator ${s.operator}, approver ${s.approver}`);

  // 7. Freeze preview.
  const prs = await openDevPrs();
  const fp = freezePlan(prs);
  step(s, 'freeze preview', 'success', `${prs.length} open PR(s) into dev; the freeze would touch ${fp.length}: ${fp.map((p) => `#${p.number}${p.queued ? '(queued)' : p.armed ? '(auto-merge)' : ''}`).join(' ') || 'none'}`);

  // 8. Store review submission is not automated (owner rule): stub only.
  const review = process.env.KC_STORE_AUTO_SUBMIT_REVIEW || 'false';
  step(s, 'store review submission', 'skipped', review === 'true'
    ? 'KC_STORE_AUTO_SUBMIT_REVIEW=true but review submission is NOT implemented; builds still go to TestFlight / Play internal only'
    : 'KC_STORE_AUTO_SUBMIT_REVIEW=false: TestFlight / Play internal only, no review submission');

  if (blockers.length) {
    for (const [name, why] of blockers) step(s, name, 'failure', why);
    s.outcome = DRY ? 'failure' : 'aborted';
    s.reason = `${DRY ? 'Dry run found' : 'Stopped before any change:'} ${blockers.length} blocker(s): ${blockers.map(([n]) => n).join(', ')}.`;
    save(s);
    output('proceed', 'false');
    throw new Abort(s.reason);
  }
  if (DRY) {
    s.outcome = 'dry_run';
    s.reason = `Dry run: all gates green. A real run would ${s.needs_version_pr ? `open a version PR (${s.version}), then ` : ''}open the release PR for v${s.version}. Nothing was changed.`;
    save(s);
    return output('proceed', 'false');
  }
  s.outcome = 'running';
  save(s);
  output('proceed', 'true');
}

async function openDevPrs() {
  const out = [];
  let after = null;
  for (;;) {
    const d = await gql('workflow', `query($o:String!,$n:String!,$a:String){repository(owner:$o,name:$n){pullRequests(states:OPEN,baseRefName:"dev",first:100,after:$a){pageInfo{hasNextPage endCursor} nodes{id number isDraft isInMergeQueue autoMergeRequest{enabledAt} labels(first:30){nodes{name}}}}}}`, { o: OWNER, n: NAME, a: after });
    const page = d.repository.pullRequests;
    out.push(...page.nodes.map((p) => ({ ...p, labels: p.labels.nodes.map((l) => l.name) })));
    if (!page.pageInfo.hasNextPage) return out;
    after = page.pageInfo.endCursor;
  }
}

// ---------------------------------------------------------------------------
// freeze / unfreeze
// ---------------------------------------------------------------------------
/** Freeze every open dev PR that could land on its own; adds to s.freeze. Returns the newly frozen. */
async function freezeNew(s) {
  const prs = await openDevPrs();
  const ids = Object.fromEntries(prs.map((p) => [p.number, p.id]));
  const fp = freezePlan(prs, [s.version_pr].filter(Boolean));
  s.freeze ??= [];
  s.frozen ??= [];
  for (const p of fp) {
    if (p.queued) await gql('operator', 'mutation($id:ID!){dequeuePullRequest(input:{id:$id}){clientMutationId}}', { id: ids[p.number] });
    if (p.armed) await gql('operator', 'mutation($id:ID!){disablePullRequestAutoMerge(input:{pullRequestId:$id}){clientMutationId}}', { id: ids[p.number] });
    if (p.addLabel) {
      await api('operator', 'POST', repoPath(`issues/${p.number}/labels`), { labels: [FREEZE_LABEL] });
      const events = await list('workflow', repoPath(`issues/${p.number}/events`));
      const last = events.filter(e => ['labeled', 'unlabeled'].includes(e.event) && e.label?.name === FREEZE_LABEL).at(-1);
      if (last?.event === 'labeled' && last.actor?.login === s.operator) p.hold_event_id = last.id;
    }
    const prev = s.freeze.find((x) => x.number === p.number);
    if (prev) Object.assign(prev, { armed: prev.armed || p.armed, queued: prev.queued || p.queued, addLabel: prev.addLabel || p.addLabel });
    else { s.freeze.push(p); s.frozen.push(p.number); }
    save(s);
  }
  return fp;
}

async function freeze(s) {
  await preservation(s, s.dev_sha);
  const fp = await freezeNew(s);
  step(s, 'freeze dev', 'success', fp.length ? `froze ${fp.map((p) => `#${p.number}`).join(' ')}` : 'no PR had auto-merge armed or sat in the queue');
}

async function unfreeze(s) {
  const fp = s.freeze ?? [];
  const errors = [];
  for (const p of fp) {
    try {
      const current = await get('workflow', repoPath(`pulls/${p.number}`));
      if (current.draft || current.state !== 'open') continue;
      // A train-created label can have been removed and added again by a human.
      // Only our exact label event remains ours; unknown/legacy state stays held.
      if (p.addLabel) {
        const events = await list('workflow', repoPath(`issues/${p.number}/events`));
        const last = events.filter(e => ['labeled', 'unlabeled'].includes(e.event) && e.label?.name === FREEZE_LABEL).at(-1);
        if (!p.hold_event_id || last?.id !== p.hold_event_id || last.actor?.login !== s.operator || last.event !== 'labeled') continue;
      }
      if (p.addLabel) await api('operator', 'DELETE', repoPath(`issues/${p.number}/labels/${encodeURIComponent(FREEZE_LABEL)}`), null, { allow: [404] });
      if (p.armed || p.queued) {
        const pr = await get('workflow', repoPath(`pulls/${p.number}`));
        if (pr.state === 'open' && !pr.draft && !(pr.labels ?? []).some(l => (l.name ?? l) === 'no-auto-merge' && !p.addLabel)) {
          await gql('operator', 'mutation($id:ID!){enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:SQUASH}){clientMutationId}}', { id: pr.node_id })
            .catch((e) => { if (!/clean status|already/i.test(e.message)) throw e; });
        }
      }
    } catch (e) { errors.push(`#${p.number}: ${e.message}`); }
  }
  if (!fp.length) return step(s, 'lift freeze', 'skipped', 'nothing was frozen');
  if (errors.length) return step(s, 'lift freeze', 'failure', `re-arm by hand: ${errors.join('; ')}`);
  step(s, 'lift freeze', 'success', `restored ${fp.map((p) => `#${p.number}`).join(' ')}`);
}

// ---------------------------------------------------------------------------
// head — version-only PR when dev's tip is a [skip ci] bump
// ---------------------------------------------------------------------------
const BODY_FOOTER = [
  '', '## Mapped to spec', '- Mapped to spec: N/A (release train)', '',
  '## Refactor logged', '- NA', '', '## SSOT updated', '- NA',
];

async function head(s) {
  let devSha = (await get('workflow', repoPath('commits/dev'))).sha;
  if (devSha !== s.dev_sha) abort(s, 'release head', `dev moved during the plan (${s.dev_sha.slice(0, 8)} → ${devSha.slice(0, 8)}); the next run will pick it up`);
  if (!s.needs_version_pr) { s.head_sha = devSha; return step(s, 'release head', 'success', `dev tip ${devSha.slice(0, 8)} (already CI-run)`); }

  const branch = `release-train/v${s.version}-${process.env.GITHUB_RUN_ID || Date.now()}`;
  await api('operator', 'POST', repoPath('git/refs'), { ref: `refs/heads/${branch}`, sha: devSha });
  const file = await get('operator', repoPath(`contents/app/VERSION?ref=${encodeURIComponent(branch)}`));
  const title = `chore(release): set app version ${s.version} for the weekly release train`;
  await api('operator', 'PUT', repoPath('contents/app/VERSION'), {
    branch, sha: file.sha, message: title, content: Buffer.from(`${s.version}\n`).toString('base64'),
  });
  const body = [
    'Opened by: agent:kc-bot', '',
    '## Summary',
    `Weekly release train ${RUN_URL}. dev's tip \`${devSha.slice(0, 8)}\` is an automatic \`[skip ci]\` version bump, so a release PR on it would get no PR CI.`,
    `A merge that edits \`app/VERSION\` gets no bump, so this PR's merge commit (${s.version}) becomes the release head with its own full CI.`,
    '', '## Changes', `- \`app/VERSION\` → ${s.version}.`, ...BODY_FOOTER,
  ].join('\n');
  const pr = (await api('operator', 'POST', repoPath('pulls'), { title, body, head: branch, base: 'dev' })).data;
  s.version_pr = pr.number;
  save(s);
  await api('operator', 'POST', repoPath(`issues/${pr.number}/labels`), { labels: TRAIN_LABELS });
  await gql('operator', 'mutation($id:ID!){enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:SQUASH}){clientMutationId}}', { id: pr.node_id });
  step(s, 'version PR', 'running', `#${pr.number} queued for dev`);

  const deadline = Date.now() + minutes('KC_RELEASE_TRAIN_VERSION_PR_MINUTES', 120) * MIN;
  let merged = null;
  while (Date.now() < deadline) {
    await sleep(MIN);
    await freezeNew(s);
    const cur = await get('workflow', repoPath(`pulls/${pr.number}`));
    if (cur.merged) { merged = cur.merge_commit_sha; break; }
    if (cur.state !== 'open') abort(s, 'version PR', `#${pr.number} was closed without merging`);
    const d = await gql('workflow', 'query($o:String!,$n:String!,$p:Int!){repository(owner:$o,name:$n){pullRequest(number:$p){isInMergeQueue autoMergeRequest{enabledAt}}}}', { o: OWNER, n: NAME, p: pr.number });
    const checks = judgeChecks({ checkRuns: (await get('workflow', repoPath(`commits/${cur.head.sha}/check-runs?per_page=100`))).check_runs, statuses: [], required: [] });
    if (checks.state === 'failure' || (!d.repository.pullRequest.isInMergeQueue && !d.repository.pullRequest.autoMergeRequest)) {
      abort(s, 'version PR', `#${pr.number} did not merge: ${checks.failing.join(', ') || 'dropped from the merge queue'}`);
    }
  }
  if (!merged) abort(s, 'version PR', `#${pr.number} not merged after the time limit`);
  step(s, 'version PR', 'success', `#${pr.number} merged as ${merged.slice(0, 8)}`);

  // Let bump-version-on-merge finish (it may add an ID commit, never a bump here).
  await sleep(2 * MIN);
  for (let i = 0; i < 20; i++) {
    const runs = await get('workflow', repoPath(`actions/workflows/bump-version-on-merge.yml/runs?head_sha=${merged}&per_page=5`));
    if ((runs.workflow_runs ?? []).every((r) => r.status === 'completed')) break;
    await sleep(MIN);
  }
  devSha = (await get('workflow', repoPath('commits/dev'))).sha;
  const tip = await get('workflow', repoPath(`commits/${devSha}`));
  if (isCiSkipped(tip.commit.message)) abort(s, 'release head', `dev tip ${devSha.slice(0, 8)} is a [skip ci] commit again (something merged during the freeze)`);
  const cmp = await get('workflow', repoPath(`compare/${merged}...${devSha}`));
  if (cmp.status !== 'identical' && cmp.status !== 'ahead') abort(s, 'release head', `dev tip ${devSha.slice(0, 8)} does not contain the version PR merge`);
  s.head_sha = devSha;
  step(s, 'release head', 'success', `dev tip ${devSha.slice(0, 8)} (v${s.version})`);
}

// ---------------------------------------------------------------------------
// open-pr / wait / merge
// ---------------------------------------------------------------------------
async function openPr(s) {
  await preservation(s, s.head_sha);
  const title = `${RELEASE_SUBJECT} (v${s.version})`;
  const commits = await get('workflow', repoPath(`compare/${s.main_sha}...${s.head_sha}`));
  const body = [
    'Opened by: agent:kc-bot', '',
    `Weekly release train ${RUN_URL}: v${s.version}, dev head \`${s.head_sha}\`. Release preparation scope recorded 19 Nov 2026; release execution remains subject to the applicable owner approval. The train stops on any failing check, a destructive migration, a missing backup, or a failed deploy.`,
    '', '## Summary',
    `${commits.ahead_by} commit(s), ${commits.files?.length ?? '?'} file(s) on top of main \`${s.main_sha.slice(0, 8)}\`.`,
    s.migrations?.length ? `Migrations: ${s.migrations.map((m) => `\`${m}\``).join(', ')} (strict scan: none destructive).` : 'No migration changes.',
    '', '## After merge',
    'Deploy (main): approved by the train, backup, migrations, functions, web, smoke, tag. Then prod-store-build: TestFlight + Play internal only. No store publication.',
    '', '## Rollback',
    'A failed functions/web/smoke stage rolls back automatically (deploy-rollback.yml) unless the release applied migrations (forward-fix).',
    ...BODY_FOOTER,
  ].join('\n');
  releaseSquashMessage({ number: 1, title, headSha: s.head_sha }); // fail early on a bad title
  const pr = (await api('operator', 'POST', repoPath('pulls'), { title, body, head: 'dev', base: 'main' })).data;
  s.release_pr = pr.number;
  save(s);
  await api('operator', 'POST', repoPath(`issues/${pr.number}/labels`), { labels: TRAIN_LABELS });
  if (pr.head.sha !== s.head_sha) abort(s, 'release PR', `dev moved to ${pr.head.sha.slice(0, 8)} while opening #${pr.number}`);
  step(s, 'release PR', 'success', `#${pr.number} ${pr.html_url}`);
}

async function rerunFailed(headSha) {
  const runs = await get('workflow', repoPath(`actions/runs?head_sha=${headSha}&status=completed&per_page=50`));
  const failed = (runs.workflow_runs ?? []).filter((r) => ['failure', 'timed_out', 'cancelled'].includes(r.conclusion));
  for (const r of failed) await api('operator', 'POST', repoPath(`actions/runs/${r.id}/rerun-failed-jobs`), {});
  return failed.map((r) => r.html_url);
}

async function wait(s) {
  const deadline = Date.now() + minutes('KC_RELEASE_TRAIN_CHECKS_MINUTES', 240) * MIN;
  let retries = minutes('KC_RELEASE_TRAIN_RETRIES', 1);
  while (Date.now() < deadline) {
    await sleep(MIN);
    const late = await freezeNew(s); // auto-merge armed during the train (e.g. dependabot)
    if (late.length) log(`froze late: ${late.map((p) => `#${p.number}`).join(' ')}`);
    const pr = await get('workflow', repoPath(`pulls/${s.release_pr}`));
    if (pr.state !== 'open') abort(s, 'checks', `#${s.release_pr} is ${pr.state}`);
    if (pr.head.sha !== s.head_sha) abort(s, 'checks', `dev moved during the train (${s.head_sha.slice(0, 8)} → ${pr.head.sha.slice(0, 8)}): someone merged into dev despite the freeze`);
    const checkRuns = await list('workflow', repoPath(`commits/${s.head_sha}/check-runs`), 'check_runs');
    const statuses = (await get('workflow', repoPath(`commits/${s.head_sha}/status`))).statuses;
    const v = judgeChecks({ checkRuns, statuses });
    if (v.state === 'failure') {
      if (retries > 0) {
        retries--;
        const rerun = await rerunFailed(s.head_sha);
        step(s, 'checks', 'running', `retrying failed jobs once (${v.failing.join(', ')}): ${rerun.join(' ')}`);
        await sleep(3 * MIN);
        continue;
      }
      abort(s, 'checks', `failing: ${v.failing.join(', ')}`);
    }
    if (v.state === 'success') {
      if (pr.mergeable_state === 'clean') return step(s, 'checks', 'success', 'CI gate, CI verdict, release E2E and every other check green; PR clean');
      if (['dirty', 'blocked'].includes(pr.mergeable_state) && Date.now() > deadline - 30 * MIN) abort(s, 'checks', `PR is ${pr.mergeable_state}`);
    }
  }
  abort(s, 'checks', 'checks did not finish in time');
}

async function merge(s) {
  await preservation(s, s.head_sha);
  const pr = await get('workflow', repoPath(`pulls/${s.release_pr}`));
  const problems = releasePrProblems(pr, s.head_sha);
  if (problems.length) abort(s, 'merge to main', problems.join('; '));
  const { subject, body } = releaseSquashMessage({ number: pr.number, title: pr.title, headSha: s.head_sha });
  // dev survives the merge: ruleset "dev: never deleted" has no bypass actor, so
  // delete_branch_on_merge cannot remove it. The toggle below is belt and braces.
  const before = (await get('operator', repoPath(''))).delete_branch_on_merge;
  if (before) await api('operator', 'PATCH', repoPath(''), { delete_branch_on_merge: false });
  let merged;
  try {
    merged = (await api('operator', 'PUT', repoPath(`pulls/${pr.number}/merge`), { merge_method: 'squash', sha: s.head_sha, commit_title: subject, commit_message: body })).data.sha;
  } finally {
    if (before) await api('operator', 'PATCH', repoPath(''), { delete_branch_on_merge: true });
  }
  s.merge_sha = merged;
  save(s);
  const dev = await api('workflow', 'GET', repoPath('git/ref/heads/dev'), null, { allow: [404] });
  if (dev.status === 404) {
    await api('operator', 'POST', repoPath('git/refs'), { ref: 'refs/heads/dev', sha: s.head_sha });
    abort(s, 'merge to main', `merged ${merged.slice(0, 8)} but dev was deleted; recreated it at ${s.head_sha.slice(0, 8)} — check open PRs were not retargeted to main`);
  }
  step(s, 'merge to main', 'success', `#${pr.number} → main ${merged.slice(0, 8)}`);
}

// ---------------------------------------------------------------------------
// deploy — approve production, then verify backup, smoke, tag, live version
// ---------------------------------------------------------------------------
async function deploy(s) {
  await preservation(s, s.merge_sha, { main: s.merge_sha, dev: s.head_sha });
  const deadline = Date.now() + minutes('KC_RELEASE_TRAIN_DEPLOY_START_MINUTES', 90) * MIN;
  let run = null;
  let pending = null;
  while (Date.now() < deadline && !run) {
    await sleep(MIN);
    const runs = await get('workflow', repoPath(`actions/workflows/deploy.yml/runs?head_sha=${s.merge_sha}&per_page=20`));
    for (const r of (runs.workflow_runs ?? []).sort((a, b) => a.id - b.id)) {
      if (r.status !== 'waiting' || r.head_sha !== s.merge_sha || r.head_branch !== 'main' || r.event !== 'workflow_run') continue;
      const p = await get('approver', repoPath(`actions/runs/${r.id}/pending_deployments`));
      const prod = p.find((d) => d.environment?.name === 'production');
      if (prod) { run = r; pending = prod; break; }
    }
    const ci = await get('workflow', repoPath(`actions/workflows/ci.yml/runs?head_sha=${s.merge_sha}&event=push&per_page=5`));
    const bad = (ci.workflow_runs ?? []).find((r) => r.status === 'completed' && r.conclusion !== 'success');
    if (!run && bad) abort(s, 'deploy', `main push CI failed: ${bad.html_url}`);
  }
  if (!run) abort(s, 'deploy', 'no Deploy (main) run waiting for production approval');
  s.deploy_run_url = run.html_url;
  save(s);
  if (!pending.current_user_can_approve) abort(s, 'deploy', `approver token cannot approve ${run.html_url}`);

  // Gates right before the click: main still at the release, backup still fresh.
  const mainSha = (await get('workflow', repoPath('commits/main'))).sha;
  if (mainSha !== s.merge_sha) abort(s, 'deploy', `main moved to ${mainSha.slice(0, 8)}`);
  await preservation(s, s.merge_sha, { main: s.merge_sha, dev: s.head_sha });
  const backups = await get('workflow', repoPath('actions/workflows/db-backup-prod.yml/runs?branch=main&status=success&per_page=1'));
  const ageH = backups.workflow_runs?.[0] ? (Date.now() - Date.parse(backups.workflow_runs[0].updated_at)) / 3.6e6 : Infinity;
  if (ageH > minutes('KC_RELEASE_TRAIN_BACKUP_MAX_AGE_HOURS', 30) + 8) abort(s, 'deploy', `prod backup is ${ageH.toFixed(1)} h old`);

  await api('approver', 'POST', repoPath(`actions/runs/${run.id}/pending_deployments`), {
    environment_ids: [pending.environment.id], state: 'approved',
    comment: `Weekly release train ${RUN_URL}: v${s.version}, all gates green.`,
  });
  step(s, 'approve production', 'success', run.html_url);

  const end = Date.now() + minutes('KC_RELEASE_TRAIN_DEPLOY_MINUTES', 120) * MIN;
  let done = null;
  while (Date.now() < end) {
    await sleep(MIN);
    const r = await get('workflow', repoPath(`actions/runs/${run.id}`));
    if (r.status === 'completed') { done = r; break; }
  }
  if (!done) abort(s, 'deploy', `Deploy did not finish in time: ${run.html_url}`);
  const jobs = await list('workflow', repoPath(`actions/runs/${run.id}/jobs?filter=latest`), 'jobs');
  const v = deployVerdict(jobs);
  s.deploy = v;
  if (!v.ok) abort(s, 'deploy', `${v.problems.join(', ')}; rollback: ${v.rollback}. ${run.html_url}`);
  if (s.migrations?.length) {
    const arts = await get('workflow', repoPath(`actions/runs/${run.id}/artifacts?per_page=100`));
    if (!(arts.artifacts ?? []).some((a) => a.name.startsWith(`prod-db-backup-${s.merge_sha}`))) abort(s, 'deploy', 'release applied migrations but the run has no prod-db-backup artifact');
  }
  step(s, 'deploy', 'success', `backup, migrations, functions, web, smoke, tag green: ${run.html_url}`);

  // Tag and live version.
  const ref = await get('workflow', repoPath(`git/ref/tags/v${s.version}`));
  const tagged = ref.object.type === 'tag' ? (await get('workflow', repoPath(`git/tags/${ref.object.sha}`))).object.sha : ref.object.sha;
  if (tagged !== s.merge_sha) abort(s, 'verify tag and live version', `v${s.version} points at ${tagged.slice(0, 8)}, not ${s.merge_sha.slice(0, 8)}`);
  const url = (process.env.KC_PROD_URL || 'https://karma-community-kc.com').replace(/\/$/, '');
  const live = await (await fetch(`${url}/version.json?train=${Date.now()}`, { cache: 'no-store' })).json().catch(() => ({}));
  if (live.sha !== s.merge_sha || live.version !== s.version) abort(s, 'verify tag and live version', `${url}/version.json reports ${JSON.stringify(live).slice(0, 120)}`);
  step(s, 'verify tag and live version', 'success', `v${s.version} → ${s.merge_sha.slice(0, 8)}; ${url} serves it`);
}

// ---------------------------------------------------------------------------
// sync — main back into dev as a merge commit (sync-main-to-dev.yml opens it)
// ---------------------------------------------------------------------------
async function sync(s) {
  const deadline = Date.now() + minutes('KC_RELEASE_TRAIN_SYNC_MINUTES', 30) * MIN;
  let pr = null;
  while (Date.now() < deadline && !pr) {
    const cmp = await get('workflow', repoPath(`compare/dev...${s.merge_sha}`));
    if (cmp.status === 'behind' || cmp.status === 'identical') return step(s, 'sync main → dev', 'success', 'dev already contains the release commit');
    const open = await get('workflow', repoPath('pulls?state=open&base=dev&per_page=50'));
    pr = open.find((p) => p.head.ref.startsWith('sync/') && Date.parse(p.created_at) > Date.parse(s.started_at));
    if (!pr) await sleep(MIN);
  }
  if (!pr) abort(s, 'sync main → dev', 'sync-main-to-dev opened no PR');
  s.sync_pr = pr.number;
  save(s);
  const files = await get('workflow', repoPath(`pulls/${pr.number}/files?per_page=5`));
  if (files.length) abort(s, 'sync main → dev', `#${pr.number} is not zero-diff (${files.length}+ files)`);
  const commit = await get('workflow', repoPath(`commits/${pr.head.sha}`));
  if (!commit.parents.some((p) => p.sha === s.merge_sha)) abort(s, 'sync main → dev', `#${pr.number} does not merge ${s.merge_sha.slice(0, 8)}`);
  await api('operator', 'POST', repoPath(`issues/${pr.number}/labels`), { labels: TRAIN_LABELS });
  // A merge commit keeps main's commit in dev's history; the queue only squashes,
  // so the operator (admin, ruleset bypass) merges it with merge commits allowed
  // for this one call.
  await api('operator', 'PATCH', repoPath(''), { allow_merge_commit: true });
  try {
    await api('operator', 'PUT', repoPath(`pulls/${pr.number}/merge`), { merge_method: 'merge', sha: pr.head.sha });
  } finally {
    await api('operator', 'PATCH', repoPath(''), { allow_merge_commit: false });
  }
  step(s, 'sync main → dev', 'success', `#${pr.number} merged as a merge commit`);
}

// ---------------------------------------------------------------------------
// stores — report the automatic PROD store build (TestFlight / Play internal)
// ---------------------------------------------------------------------------
async function stores(s) {
  const deadline = Date.now() + minutes('KC_RELEASE_TRAIN_STORE_MINUTES', 100) * MIN;
  let run = null;
  while (Date.now() < deadline) {
    const runs = await get('workflow', repoPath(`actions/workflows/prod-store-build.yml/runs?per_page=10`));
    run = (runs.workflow_runs ?? []).find((r) => Date.parse(r.created_at) > Date.parse(s.started_at) && r.event === 'workflow_run') ?? run;
    if (run) { s.store_run_url = run.html_url; save(s); }
    if (run?.status === 'completed') break;
    await sleep(2 * MIN);
  }
  if (!run) return step(s, 'store builds', 'failure', 'prod-store-build did not start after the tagged Deploy');
  if (run.status !== 'completed') return step(s, 'store builds', 'running', `still running: ${run.html_url}`);
  const jobs = await list('workflow', repoPath(`actions/runs/${run.id}/jobs?filter=latest`), 'jobs');
  const lanes = jobs.filter((j) => /TestFlight|Play Internal/i.test(j.name)).map((j) => `${j.name}: ${j.conclusion}`).join(', ');
  step(s, 'store builds', run.conclusion === 'success' ? 'success' : 'failure', `${lanes || run.conclusion} — ${run.html_url} (no review submission)`);
}

// ---------------------------------------------------------------------------
// report — job summary, status file, optional issue comment
// ---------------------------------------------------------------------------
async function report(s) {
  if (s.outcome === 'running' || !s.outcome) {
    const failed = (s.steps ?? []).some((x) => x.result === 'failure');
    s.outcome = failed ? 'failure' : 'success';
    if (!s.reason) s.reason = failed ? 'Released, but a later step failed (see the table).' : `Released v${s.version} to production; store builds queued for TestFlight / Play internal.`;
  }
  s.finished_at = new Date().toISOString();
  save(s);
  const md = renderSummary(s);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  log(md);
  const issue = process.env.KC_RELEASE_TRAIN_ISSUE;
  if (issue && /^\d+$/.test(issue) && (!DRY || s.outcome === 'failure')) {
    await api('workflow', 'POST', repoPath(`issues/${issue}/comments`), { body: `${md}\n${RUN_URL}` }).catch((e) => log(`::warning::issue comment failed: ${e.message}`));
  }
  output('outcome', s.outcome);
}

const STEPS = { plan, freeze, head, 'open-pr': openPr, wait, merge, deploy, sync, unfreeze, stores, report };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const name = process.argv[2];
  const fn = STEPS[name];
  if (!fn) { console.error(`usage: release-train.mjs <${Object.keys(STEPS).join('|')}>`); process.exit(2); }
  const s = load();
  fn(s).catch((err) => {
    if (!(err instanceof Abort)) {
      try { step(s, name, 'failure', err.message); s.outcome = s.merge_sha ? 'failure' : 'aborted'; s.reason ||= `Stopped at "${name}": ${err.message}`; save(s); } catch { /* keep the original error */ }
    }
    console.error(`::error::${err.message}`);
    process.exit(1);
  });
}
