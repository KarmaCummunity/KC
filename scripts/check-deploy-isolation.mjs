#!/usr/bin/env node
// Static guard: production can only be deployed through
// .github/workflows/deploy.yml (D-195, INFRA-CI-3), behind CI and the owner's
// one approval click. The runtime deploy guard (scripts/deploy-guard.mjs) is
// the primary control; this catches a bypass at review time, before it runs.
//
// Workflows are parsed with a real YAML parser (a quoted "on": key, flow
// mappings or block scalars cannot hide anything). Rules:
//   • deploy.yml triggers only on workflow_run / workflow_dispatch and is the
//     only file that may use the `production` (approval) environment;
//   • stage workflows (STAGES) are reusable: workflow_call, plus a manual
//     dispatch where STAGES allows one;
//   • only deploy.yml and deploy-rollback.yml may call a deploy* workflow;
//   • only deploy.yml and the stages may name a prod environment; a templated
//     environment (${{ … }}) is allowed only in a stage, and only as
//     supabase-/cloudflare-${{ inputs.target }};
//   • a listed read-only monitor (MONITORS) may resolve a static matrix to its
//     allowed Supabase environments, and runs no deploy command;
//   • each deploy command runs only in its own stage, never in any other
//     workflow or in a composite action;
//   • in the stages, every job that holds an environment or can write is a
//     GUARDED_JOBS entry whose first two steps check out deploy.yml's own
//     commit and run the deploy guard from it.
//
// Run `npm ci --prefix scripts` first (the `yaml` parser).

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORCHESTRATOR = 'deploy.yml';
const CALLERS = new Set([ORCHESTRATOR, 'deploy-rollback.yml']);

/** Stage workflow → triggers it may have besides workflow_call. */
export const STAGES = {
  'deploy-preflight.yml': [],
  'deploy-db.yml': [],
  'deploy-functions.yml': [],
  'deploy-web.yml': [],
  'deploy-smoke.yml': ['workflow_dispatch'],
  'deploy-rollback.yml': [],
  'deploy-tag.yml': [],
};

/** Stage → jobs that change an environment and must start with the guard. */
export const GUARDED_JOBS = {
  'deploy-db.yml': ['backup', 'migrate'],
  'deploy-functions.yml': ['deploy'],
  'deploy-web.yml': ['deploy'],
  'deploy-tag.yml': ['tag'],
  'deploy-rollback.yml': ['web'],
};

/** Deploy command → the only workflow allowed to run it. */
export const COMMANDS = [
  { re: /\bsupabase\s+(?:db\s+push|migration\s+up)\b/, owner: 'deploy-db.yml', what: 'supabase db push / migration up' },
  { re: /\bsupabase\s+(?:functions\s+deploy|secrets\s+set)\b/, owner: 'deploy-functions.yml', what: 'supabase functions deploy / secrets set' },
  { re: /\bpages\s+deploy\b|cloudflare\/wrangler-action/, owner: 'deploy-web.yml', what: 'Cloudflare Pages deploy' },
];

/**
 * Read-only monitors allowed to hold a Supabase environment outside the deploy
 * pipeline: workflow → its single job, the matrix-listed environments it may
 * resolve to, and the triggers it may have. The job still may not run any
 * deploy command (COMMANDS) and may not name `production` or a Cloudflare
 * environment. Holding prod secrets outside deploy.yml is tracked as TD-232.
 */
export const MONITORS = {
  'ops-health.yml': { job: 'monitor', envs: ['supabase-dev', 'supabase-prod'], triggers: ['schedule', 'workflow_dispatch'] },
  'ci-prod-ledger.yml': { job: 'ledger', envs: ['supabase-prod'], triggers: ['schedule', 'workflow_dispatch'] },
  // Read-only ledger gate of the PROD store-build pipeline. Other jobs in this
  // workflow use mobile-store (or no environment) and must not use `production`.
  'prod-store-build.yml': { job: 'ledger', envs: ['supabase-prod'], triggers: ['workflow_run', 'workflow_dispatch'] },
};

const PROD_ENVS = new Set(['production', 'supabase-prod', 'cloudflare-prod']);
const MONITOR_ENV_TEMPLATE = /^\$\{\{\s*matrix\.target\.environment\s*\}\}$/;
const STAGE_ENV_TEMPLATE = /^(?:supabase|cloudflare)-\$\{\{\s*inputs\.target\s*\}\}$/;
const CALLS_DEPLOY = /\.github\/workflows\/deploy[^/]*\.ya?ml/;
const GUARD_ACTION = './.deploy-guard/.github/actions/deploy-guard';

/** Trigger names of a parsed workflow (`on` as string, list or mapping). */
export function triggers(doc) {
  const on = doc?.on ?? doc?.[true] ?? null;
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.map(String);
  return on && typeof on === 'object' ? Object.keys(on) : [];
}

const jobsOf = (doc) => Object.entries(doc?.jobs ?? {});
const envName = (job) => (typeof job.environment === 'object' ? job.environment?.name : job.environment);
const steps = (job) => (Array.isArray(job.steps) ? job.steps : []);

function checkTriggers(file, doc) {
  const on = triggers(doc);
  if (file === ORCHESTRATOR) {
    const extra = on.filter((t) => !['workflow_run', 'workflow_dispatch', 'push'].includes(t));
    const errors = extra.length ? [`${file}: may trigger only on workflow_run / workflow_dispatch / push to dev (found ${extra.join(', ')})`] : [];
    if (on.includes('push')) {
      const push = (doc?.on ?? doc?.[true])?.push;
      const branches = push?.branches;
      const devOnly = Array.isArray(branches) && branches.length === 1 && branches[0] === 'dev'
        && Object.keys(push).every((k) => k === 'branches');
      if (!devOnly) errors.push(`${file}: a push trigger must be exactly branches: [dev] (prod never deploys on push)`);
    }
    return errors;
  }
  if (!Object.hasOwn(STAGES, file)) return [];
  const extra = on.filter((t) => t !== 'workflow_call' && !STAGES[file].includes(t));
  return extra.length ? [`${file}: deploy stages are reusable; trigger ${extra.join(', ')} is not allowed`] : [];
}

/**
 * True when `job` in `file` is a listed read-only monitor whose environment is
 * `${{ matrix.target.environment }}` and every matrix entry resolves to one of
 * its allowed environments, and the workflow has only the allowed triggers.
 */
function isAllowedMonitor(file, id, job, doc, value) {
  const monitor = Object.hasOwn(MONITORS, file) ? MONITORS[file] : null;
  if (!monitor || id !== monitor.job || !MONITOR_ENV_TEMPLATE.test(value)) return false;
  const targets = job?.strategy?.matrix?.target;
  const envsOk = Array.isArray(targets) && targets.length > 0
    && targets.every((t) => monitor.envs.includes(t?.environment));
  const triggersOk = triggers(doc).every((t) => monitor.triggers.includes(t));
  return envsOk && triggersOk;
}

function checkEnvironment(file, id, name, job, doc) {
  if (name === undefined || name === null) return [];
  const value = String(name);
  const isStage = Object.hasOwn(STAGES, file);
  if (value.includes('${{')) {
    if (isStage && STAGE_ENV_TEMPLATE.test(value)) return [];
    if (isAllowedMonitor(file, id, job, doc, value)) return [];
    return [`${file}: job ${id} has a templated environment (${value}); only deploy stages may template it, as supabase-/cloudflare-\${{ inputs.target }}`];
  }
  if (value === 'production' && file !== ORCHESTRATOR) return [`${file}: only ${ORCHESTRATOR} may use the production approval environment`];
  if (PROD_ENVS.has(value) && file !== ORCHESTRATOR && !isStage) return [`${file}: job ${id} uses ${value}; deploy through ${ORCHESTRATOR}`];
  return [];
}

function checkCommands(file, id, job) {
  const texts = [job.uses, ...steps(job).flatMap((s) => [s.run, s.uses, s.with?.command])].filter((t) => typeof t === 'string');
  const errors = [];
  for (const { re, owner, what } of COMMANDS) {
    if (file !== owner && texts.some((t) => re.test(t))) errors.push(`${file}: job ${id} runs ${what}, which only ${owner} may run`);
  }
  if (!CALLERS.has(file) && typeof job.uses === 'string' && CALLS_DEPLOY.test(job.uses)) {
    errors.push(`${file}: job ${id} calls ${job.uses}; only ${[...CALLERS].join(' and ')} may call deploy workflows`);
  }
  return errors;
}

/** In a guarded stage, jobs that hold an environment or write must start with the guard. */
function checkGuards(file, doc) {
  if (!Object.hasOwn(GUARDED_JOBS, file)) return [];
  const errors = [];
  for (const [id, job] of jobsOf(doc)) {
    const mutating = envName(job) || job.permissions?.contents === 'write';
    const listed = GUARDED_JOBS[file].includes(id);
    if (mutating && !listed) errors.push(`${file}: job ${id} holds an environment or write access but is not a GUARDED_JOBS entry`);
    if (!listed || job.uses) continue;
    const [checkout, guard] = steps(job);
    const trusted = checkout?.uses?.startsWith('actions/checkout@') && /github\.workflow_sha/.test(checkout?.with?.ref ?? '');
    if (!trusted || guard?.uses !== GUARD_ACTION) {
      errors.push(`${file}: job ${id} must start with a checkout of github.workflow_sha and ${GUARD_ACTION}`);
    }
  }
  for (const id of GUARDED_JOBS[file]) {
    if (!doc?.jobs?.[id]) errors.push(`${file}: guarded job ${id} is missing`);
  }
  return errors;
}

/** Violations for one workflow file's text. */
export function checkWorkflow(file, text) {
  let doc;
  try {
    doc = parse(text);
  } catch (err) {
    return [`${file}: not valid YAML (${err.message.split('\n')[0]})`];
  }
  const errors = [...checkTriggers(file, doc), ...checkGuards(file, doc)];
  for (const [id, job] of jobsOf(doc)) {
    errors.push(...checkEnvironment(file, id, envName(job), job, doc), ...checkCommands(file, id, job));
  }
  return errors;
}

/** Violations for a composite action: it may run no deploy command at all. */
export function checkAction(path, text) {
  const runs = parse(text)?.runs?.steps ?? [];
  const texts = runs.flatMap((s) => [s.run, s.uses, s.with?.command]).filter((t) => typeof t === 'string');
  return COMMANDS.filter(({ re }) => texts.some((t) => re.test(t))).map(({ what }) => `${path}: runs ${what}; deploy commands live only in the deploy stages`);
}

export function checkDeployIsolation(root = DEFAULT_ROOT) {
  const dir = join(root, '.github/workflows');
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  const errors = files.flatMap((f) => checkWorkflow(f, readFileSync(join(dir, f), 'utf8')));
  const actions = join(root, '.github/actions');
  for (const name of existsSync(actions) ? readdirSync(actions) : []) {
    const path = join(actions, name, 'action.yml');
    if (existsSync(path)) errors.push(...checkAction(`.github/actions/${name}/action.yml`, readFileSync(path, 'utf8')));
  }
  for (const required of [ORCHESTRATOR, ...Object.keys(STAGES)]) {
    if (!files.includes(required)) errors.push(`.github/workflows/${required} is missing`);
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = checkDeployIsolation();
  for (const e of errors) console.error(`  • ${e}`);
  if (errors.length) {
    console.error('✗ Deploy isolation guard failed: production deploys must go through deploy.yml.');
    process.exit(1);
  }
  console.log('✓ Deploy isolation guard passed — deploys run only through deploy.yml and its guarded stages.');
}
