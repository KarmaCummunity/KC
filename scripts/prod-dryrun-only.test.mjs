import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stringify } from 'yaml';
import { checkWorkflow } from './check-deploy-isolation.mjs';
import { DRYRUN_WORKFLOW } from './release/prod-dryrun-contract.mjs';
import { DRYRUN_ARGS, verifyLedger, parseDryRunPlan, run } from './release/prod-dryrun-only.mjs';
import { RELEASE_PLAN } from './release/prod-dryrun-plan.mjs';
const clone = () => structuredClone(DRYRUN_WORKFLOW);
const fails = (mutate) => { const d = clone(); mutate(d); assert.ok(checkWorkflow('prod-migration-dryrun.yml', stringify(d)).length); };
test('exact dedicated monitor passes', () => assert.deepEqual(checkWorkflow('prod-migration-dryrun.yml', stringify(clone())), []));
test('fixed argv includes mandatory dry-run and no other mode', () => {
  assert.deepEqual(DRYRUN_ARGS, ['db','push','--dry-run','--linked','--yes']);
  assert.ok(Object.isFrozen(DRYRUN_ARGS));
});
test('candidate ledger and exact migration inputs are bounded', () => {
  assert.equal(RELEASE_PLAN.ledger.length,55);
  assert.equal(RELEASE_PLAN.pending.length,20); assert.equal(Object.keys(RELEASE_PLAN.files).length,75);
  verifyLedger(RELEASE_PLAN.ledger.map(version=>({version})), RELEASE_PLAN.ledger);
  assert.throws(()=>verifyLedger([],RELEASE_PLAN.ledger),/ledger changed/);
  assert.throws(()=>verifyLedger([...RELEASE_PLAN.ledger,'9999'].map(version=>({version})),RELEASE_PLAN.ledger));
});
test('wrong file/job/environment/ref, credentials and commands are rejected', () => {
  assert.ok(checkWorkflow('other.yml', stringify(clone())).length);
  for (const mutate of [
    d=>{d.jobs.other=d.jobs.dryrun;delete d.jobs.dryrun;},
    d=>{d.jobs.dryrun.environment='supabase-prod';},
    d=>{d.jobs.dryrun.strategy.matrix.target[0].environment='supabase-dev';},
    d=>{d.jobs.dryrun.if='true';}, d=>{d.on.push={branches:['main']};},
    d=>{d.on={workflow_call:null};}, d=>{d.permissions.contents='write';},
    d=>{d.jobs.dryrun.steps[0].with.ref='dev';}, d=>{d.jobs.dryrun.steps[0].with['persist-credentials']=true;},
    d=>{d.jobs.dryrun.steps.push({run:'supabase db push --linked'});},
    d=>{d.jobs.dryrun.steps.push({run:'supabase migration repair --status applied 0070'});},
    d=>{d.jobs.dryrun.steps[3].env.SUPABASE_PROJECT_REF='other';},
  ]) fails(mutate);
  for (const command of ['supabase db push --linked','supabase db push --dry-run=false --linked',
    'supabase db push $FLAGS','supabase db push --dry-run --include-all','supabase db push --dry-run; supabase db push',
    'node scripts/release/prod-dryrun-only.mjs --apply','node scripts/release/prod-dryrun-only.mjs && echo extra']) {
    fails(d=>{d.jobs.dryrun.steps[3].run=command;});
  }
});

test('direct invocation fails closed before network/CLI and does not print secrets', () => {
  for (const args of [[], ['--apply']]) {
    const result = spawnSync(process.execPath, ['scripts/release/prod-dryrun-only.mjs', ...args], {
      encoding: 'utf8', env: { GITHUB_REF:'refs/heads/dev', QUALIFIED_CANDIDATE:'a'.repeat(40), SUPABASE_DB_PASSWORD:'canary-never-print' },
    });
    assert.equal(result.status,1);
    assert.doesNotMatch(result.stdout + result.stderr,/canary-never-print/);
    assert.match(result.stderr,/manual MAIN only|arguments forbidden/);
  }
});

const fixture = JSON.parse(readFileSync(new URL('./release/fixtures/cli-2.99.0-dryrun.json', import.meta.url)));
test('official v2.99.0 formatter fixture parses only pending block', () => {
  assert.deepEqual(parseDryRunPlan(fixture.success.stdout,fixture.success.stderr),['0070_example.sql','0071_example.sql']);
  for (const f of [fixture.noop,fixture.error]) assert.throws(()=>parseDryRunPlan(f.stdout,f.stderr));
  for (const stderr of [
    fixture.success.stderr + 'Historical 0001_baseline.sql\n',
    fixture.success.stderr.replace('Would push these migrations:','Previously applied migrations:'),
    fixture.success.stderr.replace(' • 0070_example.sql','WARNING: 0070_example.sql'),
    fixture.success.stderr + 'Would seed these files:\n • seed.sql\n',
    fixture.success.stderr + ' • 0070_example.sql\n',
    fixture.success.stderr.replace('DRY RUN: migrations will *not* be pushed to the database.',''),
  ]) assert.throws(()=>parseDryRunPlan(fixture.success.stdout,stderr));
});
const CANDIDATE = '67aa4c6755da0bc43e1b30a80379ad7feba834be';
function harness({ failure, movedDev, wrongLedger } = {}) {
  const env={GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_WORKFLOW_SHA:'b'.repeat(40),
    GITHUB_REPOSITORY:'KarmaCummunity/KC',SUPABASE_PROJECT_REF:RELEASE_PLAN.project,KC_PROD_SCHEMA_MODE:'baseline',
    SUPABASE_ACCESS_TOKEN:'api-canary',SUPABASE_DB_PASSWORD:'db-canary',GITHUB_TOKEN:'gh-canary',QUALIFIED_CANDIDATE:CANDIDATE,PATH:process.env.PATH};
  const calls=[];let apiCalls=0;
  const deps={argv:[],git(args){
    if(args[0]==='rev-parse')return Buffer.from(env.GITHUB_WORKFLOW_SHA);
    if(args[0]==='show')return readFileSync(resolve(args[1].slice(41)));
    if(args[0]==='ls-tree')return Buffer.from(Object.keys(RELEASE_PLAN.files).join('\n'));
    throw Error('unexpected git');
  },async json(url,token,query){
    apiCalls++;
    if(url.includes('api.github.com'))return {object:{sha:movedDev && apiCalls>2?'c'.repeat(40):env.QUALIFIED_CANDIDATE}};
    assert.match(query,/^begin transaction read only; select version .*; rollback;$/);
    return (wrongLedger?[]:RELEASE_PLAN.ledger).map(version=>({version}));
  },spawn(bin,args,options){
    calls.push({bin,args,options});
    assert.equal(bin,'supabase');assert.equal(options.shell,undefined);assert.equal(options.timeout,180000);
    assert.equal(options.env.SUPABASE_DB_PASSWORD,'db-canary');
    assert.deepEqual(Object.keys(options.env).sort(),['PATH','HOME','SUPABASE_ACCESS_TOKEN','SUPABASE_DB_PASSWORD','DO_NOT_TRACK'].sort());
    assert.equal(options.env.GITHUB_TOKEN,undefined);assert.equal(options.env.QUALIFIED_CANDIDATE,undefined);
    assert.equal(existsSync(resolve(options.cwd,'supabase/config.toml')),true);
    assert.equal(existsSync(resolve(options.cwd,'supabase/seed.sql')),false);
    if(failure==='link' && args[0]==='link')return {status:1,stderr:'secret-canary',stdout:''};
    if(failure==='timeout' && args[0]==='db')return {status:null,error:{code:'ETIMEDOUT'},stderr:'secret-canary',stdout:''};
    return {status:0,stdout:args[0]==='db'?fixture.success.stdout:'',stderr:args[0]==='db'?
      'DRY RUN: migrations will *not* be pushed to the database.\nWould push these migrations:\n'+RELEASE_PLAN.pending.map(n=>' • '+n+'\n').join(''):''};
  }};return {env,deps,calls};
}
test('actual runner happy path uses only link and fixed dry-run argv, credentials bounded, cleanup runs',async()=>{
  const h=harness();await run(h.env,h.deps);
  assert.deepEqual(h.calls.map(c=>c.args),[['link','--project-ref',RELEASE_PLAN.project,'--yes'],['db','push','--dry-run','--linked','--yes']]);
  for(const c of h.calls)assert.equal(existsSync(c.options.cwd),false);
});
test('failed link, timeout, remote drift and moved DEV fail closed with cleanup',async()=>{
  for(const opts of [{failure:'link'},{failure:'timeout'},{movedDev:true},{wrongLedger:true}]){
    const h=harness(opts);await assert.rejects(()=>run(h.env,h.deps));
    if(opts.failure==='link')assert.equal(h.calls.length,1);
    if(opts.wrongLedger)assert.equal(h.calls.length,0);
    for(const c of h.calls)assert.equal(existsSync(c.options.cwd),false);
  }
});
test('config mismatch fails before credential-bearing CLI',async()=>{
  const h=harness();const git=h.deps.git;h.deps.git=args=>args[0]==='show'&&args[1].endsWith('config.toml')?Buffer.from('changed'):git(args);
  await assert.rejects(()=>run(h.env,h.deps),/config changed/);assert.equal(h.calls.length,0);
});

test('tooling-only DEV advance is not a self-referential SHA fixed point',async()=>{
  const h=harness();h.env.QUALIFIED_CANDIDATE='d'.repeat(40);await run(h.env,h.deps);
  assert.equal(h.calls.length,2);
});
test('malformed candidate or arbitrary arguments cannot reach network or CLI',async()=>{
  for(const value of ['main','HEAD','a'.repeat(39),'a'.repeat(40)+'; echo bad']){
    const h=harness();h.env.QUALIFIED_CANDIDATE=value;
    h.deps.json=()=>{throw Error('network must not execute');};
    await assert.rejects(()=>run(h.env,h.deps),/40 lowercase hex/);assert.equal(h.calls.length,0);
  }
  const h=harness();h.deps.argv=['--apply'];await assert.rejects(()=>run(h.env,h.deps),/arguments forbidden/);
});
