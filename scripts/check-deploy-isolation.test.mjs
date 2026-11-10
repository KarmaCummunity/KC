// Unit tests for scripts/check-deploy-isolation.mjs (needs `npm ci --prefix scripts`).
// Run: node --test scripts/check-deploy-isolation.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAction, checkDeployIsolation, checkWorkflow, triggers } from './check-deploy-isolation.mjs';
import { parse } from 'yaml';

const GUARD_STEPS = [
  '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
  '        with:',
  '          ref: ${{ github.workflow_sha }}',
  '          path: .deploy-guard',
  '      - uses: ./.deploy-guard/.github/actions/deploy-guard',
].join('\n');

test('triggers reads string, list, mapping and quoted "on" keys', () => {
  assert.deepEqual(triggers(parse('on: push\n')), ['push']);
  assert.deepEqual(triggers(parse('on: [push, pull_request]\n')), ['push', 'pull_request']);
  assert.deepEqual(triggers(parse('"on":\n  push:\n  workflow_dispatch:\n')), ['push', 'workflow_dispatch']);
});

test('the real workflows and actions pass', () => {
  assert.deepEqual(checkDeployIsolation(), []);
});

test('bypass (a): a push workflow calling a deploy stage with target prod is refused', () => {
  for (const stage of ['deploy-web.yml', 'deploy-db.yml', 'deploy-functions.yml']) {
    const wf = `name: x\non:\n  push:\n    branches: [main]\njobs:\n  ship:\n    uses: ./.github/workflows/${stage}\n    with:\n      target: prod\n`;
    assert.match(checkWorkflow('sneaky.yml', wf).join('\n'), /calls \.\/\.github\/workflows\/deploy-/, stage);
  }
  const remote = 'on: push\njobs:\n  ship:\n    uses: KarmaCummunity/KC/.github/workflows/deploy-web.yml@main\n';
  assert.equal(checkWorkflow('sneaky.yml', remote).length, 1);
});

test('bypass (b): a templated environment and supabase migration up are refused', () => {
  const wf = [
    'on: push',
    'jobs:',
    '  migrate:',
    "    environment: ${{ format('supabase-{0}', 'prod') }}",
    '    steps:',
    '      - run: |',
    '          supabase link --project-ref "$REF"',
    '          supabase migration up --linked',
  ].join('\n');
  const errors = checkWorkflow('sneaky.yml', wf);
  assert.ok(errors.some((e) => /templated environment/.test(e)), errors.join('\n'));
  assert.ok(errors.some((e) => /runs supabase db push \/ migration up/.test(e)), errors.join('\n'));
});

test('bypass (c): a quoted "on" key cannot hide a trigger on deploy.yml or a stage', () => {
  assert.match(checkWorkflow('deploy.yml', '"on":\n  push:\njobs: {}\n')[0], /exactly branches: \[dev\]/);
  assert.match(checkWorkflow('deploy.yml', '"on":\n  schedule:\njobs: {}\n')[0], /found schedule/);
  const stage = `"on":\n  workflow_call:\n  push:\njobs:\n  deploy:\n    environment: cloudflare-\${{ inputs.target }}\n    steps:\n${GUARD_STEPS}\n`;
  assert.match(checkWorkflow('deploy-web.yml', stage)[0], /trigger push is not allowed/);
});

test('only deploy.yml may use the production approval environment; others may not name prod', () => {
  const body = (env) => `on: workflow_call\njobs:\n  a:\n    environment:\n      name: ${env}\n    steps: []\n`;
  assert.deepEqual(checkWorkflow('deploy.yml', body('production').replace('workflow_call', 'workflow_run')), []);
  assert.match(checkWorkflow('deploy-smoke.yml', body('production'))[0], /only deploy\.yml may use the production/);
  assert.match(checkWorkflow('seed.yml', body('supabase-prod'))[0], /uses supabase-prod/);
  assert.deepEqual(checkWorkflow('seed.yml', body('supabase-dev')), []);
});

test('a guarded stage job must start with the trusted guard, and new mutating jobs must be listed', () => {
  const job = (stepsText) => `on: workflow_call\njobs:\n  deploy:\n    environment: cloudflare-\${{ inputs.target }}\n    steps:\n${stepsText}\n`;
  assert.deepEqual(checkWorkflow('deploy-web.yml', job(GUARD_STEPS)), []);
  const unguarded = job('      - uses: actions/checkout@x\n        with:\n          ref: ${{ inputs.sha }}\n      - run: echo hi');
  assert.match(checkWorkflow('deploy-web.yml', unguarded)[0], /must start with a checkout of github\.workflow_sha/);
  const extra = job(GUARD_STEPS).replace('jobs:\n', 'jobs:\n  sneak:\n    environment: cloudflare-prod\n    steps: []\n');
  assert.match(checkWorkflow('deploy-web.yml', extra).join('\n'), /job sneak holds an environment/);
});

test('deploy commands are confined to their stage and never live in a composite action', () => {
  const wf = 'on: workflow_call\njobs:\n  a:\n    steps:\n      - run: supabase db push --linked\n      # supabase functions deploy in a comment does not count\n';
  assert.deepEqual(checkWorkflow('ci-backend.yml', wf), ['ci-backend.yml: job a runs supabase db push / migration up, which only deploy-db.yml may run']);
  const action = 'runs:\n  using: composite\n  steps:\n    - uses: cloudflare/wrangler-action@v4\n      with:\n        command: pages deploy dist\n';
  assert.match(checkAction('.github/actions/x/action.yml', action)[0], /Cloudflare Pages deploy/);
});

test('invalid YAML fails instead of passing', () => {
  assert.match(checkWorkflow('broken.yml', 'on: [push\n')[0], /not valid YAML/);
});

/** A read-only monitor workflow: schedule-triggered, matrix over Supabase environments. */
function monitorYaml({ envs = ['supabase-dev', 'supabase-prod'], on = '  schedule:\n    - cron: "23 * * * *"\n  workflow_dispatch:', run = 'node scripts/ops/health-monitor.mjs', job = 'monitor' } = {}) {
  const targets = envs.map((e) => `          - { env: x, environment: ${e} }`).join('\n');
  return `on:\n${on}\njobs:\n  ${job}:\n    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        target:\n${targets}\n    environment: \${{ matrix.target.environment }}\n    steps:\n      - run: ${run}\n`;
}

test('read-only monitor: ops-health.yml may resolve its matrix to supabase-dev/prod', () => {
  assert.deepEqual(checkWorkflow('ops-health.yml', monitorYaml()), []);
});

test('read-only monitor: ci-prod-ledger.yml may resolve its matrix to supabase-prod only', () => {
  assert.deepEqual(
    checkWorkflow('ci-prod-ledger.yml', monitorYaml({ envs: ['supabase-prod'], job: 'ledger', run: 'node scripts/check-prod-ledger.mjs' })),
    [],
  );
});

test('read-only monitor: prod-store-build.yml ledger job may use supabase-prod on workflow_run', () => {
  assert.deepEqual(
    checkWorkflow(
      'prod-store-build.yml',
      monitorYaml({
        envs: ['supabase-prod'],
        job: 'ledger',
        on: '  workflow_run:\n    workflows: [Deploy]\n    types: [completed]\n  workflow_dispatch:',
        run: 'node scripts/check-prod-store-ready.mjs',
      }),
    ),
    [],
  );
});

test('read-only monitor: any other file, job, env, trigger or deploy command is refused', () => {
  const refused = (file, opts) => checkWorkflow(file, monitorYaml(opts)).length > 0;
  assert.ok(refused('other-monitor.yml', {}), 'unlisted workflow');
  assert.ok(refused('ops-health.yml', { job: 'other' }), 'unlisted job');
  assert.ok(refused('ops-health.yml', { envs: ['supabase-prod', 'cloudflare-prod'] }), 'non-listed environment');
  assert.ok(refused('ops-health.yml', { envs: ['production'] }), 'approval environment');
  assert.ok(refused('ops-health.yml', { on: '  push:' }), 'push trigger');
  assert.ok(refused('ops-health.yml', { run: 'supabase db push --linked' }), 'deploy command');
});

test('deploy.yml may trigger on push only to exactly dev (#1430)', () => {
  const wf = (on) => `on:\n${on}\njobs: {}\n`;
  assert.deepEqual(checkWorkflow('deploy.yml', wf('  push:\n    branches: [dev]\n  workflow_dispatch:')), []);
  assert.match(checkWorkflow('deploy.yml', wf('  push:\n    branches: [dev, main]'))[0], /exactly branches: \[dev\]/);
  assert.match(checkWorkflow('deploy.yml', wf('  push:'))[0], /exactly branches: \[dev\]/);
  assert.match(checkWorkflow('deploy.yml', wf('  push:\n    branches: [main]'))[0], /exactly branches: \[dev\]/);
});
