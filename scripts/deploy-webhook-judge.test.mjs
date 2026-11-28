import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';

const workflow = parse(readFileSync(new URL('../.github/workflows/deploy-functions.yml', import.meta.url), 'utf8'));
const steps = workflow.jobs.deploy.steps;

test('the trusted webhook judge is preserved before the candidate checkout cleans the workspace', () => {
  const trusted = steps.findIndex((step) => step.with?.ref === '${{ github.workflow_sha }}');
  const preserve = steps.findIndex((step) => step.name === 'Preserve trusted webhook judge across candidate checkout');
  const candidate = steps.findIndex((step) => step.with?.ref === '${{ inputs.sha }}');
  const judge = steps.findIndex((step) => step.name === 'Webhook functions authenticate their caller');
  assert.ok(trusted >= 0 && trusted < preserve && preserve < candidate && candidate < judge);
  assert.match(steps[trusted].with['sparse-checkout'], /scripts\/check-webhook-auth\.mjs/);
  assert.equal(steps[preserve].run, 'cp .deploy-guard/scripts/check-webhook-auth.mjs "$RUNNER_TEMP/trusted-check-webhook-auth.mjs"');
  assert.equal(steps[judge].run, 'node "$RUNNER_TEMP/trusted-check-webhook-auth.mjs" --root "$GITHUB_WORKSPACE"');
});

test('the preserved judge survives a cleaned checkout and rejects an unauthenticated candidate', () => {
  const root = mkdtempSync(join(tmpdir(), 'kc-trusted-webhook-'));
  try {
    const workspace = join(root, 'workspace');
    const runnerTemp = join(root, 'runner-temp');
    mkdirSync(join(workspace, '.deploy-guard', 'scripts'), { recursive: true });
    mkdirSync(runnerTemp);
    cpSync(new URL('./check-webhook-auth.mjs', import.meta.url), join(workspace, '.deploy-guard/scripts/check-webhook-auth.mjs'));
    const env = { ...process.env, RUNNER_TEMP: runnerTemp, GITHUB_WORKSPACE: workspace };
    const preserve = steps.find((step) => step.name === 'Preserve trusted webhook judge across candidate checkout');
    assert.equal(spawnSync('bash', ['-eu', '-c', preserve.run], { cwd: workspace, env }).status, 0);
    rmSync(workspace, { recursive: true });
    mkdirSync(join(workspace, 'supabase/functions/new-hook'), { recursive: true });
    writeFileSync(join(workspace, 'supabase/config.toml'), '[functions.new-hook]\nverify_jwt = false\n');
    writeFileSync(join(workspace, 'supabase/functions/new-hook/index.ts'), 'export const unsafeHandler = () => 200;\n');
    // A candidate cannot replace the trusted judge with a passing implementation.
    mkdirSync(join(workspace, '.deploy-guard/scripts'), { recursive: true });
    writeFileSync(join(workspace, '.deploy-guard/scripts/check-webhook-auth.mjs'), 'process.exit(0);\n');
    const judge = steps.find((step) => step.name === 'Webhook functions authenticate their caller');
    const result = spawnSync('bash', ['-eu', '-c', judge.run], { cwd: workspace, env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /new-hook: verify_jwt = false but not registered/);
    assert.doesNotMatch(result.stderr, /Cannot find module/);
    writeFileSync(join(workspace, 'supabase/config.toml'), '[functions.new-hook]\nverify_jwt = true\n');
    assert.equal(spawnSync('bash', ['-eu', '-c', judge.run], { cwd: workspace, env }).status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
