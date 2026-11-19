import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { PRESERVATION_FILES, preservationPreflight } from './release-preservation.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const dir=mkdtempSync(join(tmpdir(),'kc-train-proof-'));
const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.test');
for(const p of ['scripts/release-train.mjs','scripts/release-train-lib.mjs','scripts/release-merge.mjs','scripts/release-preservation.mjs']) {
 mkdirSync(dirname(join(dir,p)),{recursive:true});cpSync(join(root,p),join(dir,p));
}
function commit(label){git('add','.');git('commit','-qm',label);return git('rev-parse','HEAD');}
writeFileSync(join(dir,'app-placeholder'),'fixture');mkdirSync(join(dir,'.github/workflows'),{recursive:true});writeFileSync(join(dir,'.github/workflows/deploy.yml'),'name: unsafe\n');const old=commit('old unsafe');
// Review fixture: byte copies of the seven #2510 contract files, no network or Git objects required.
const reviewed=JSON.parse(readFileSync(join(root,'scripts/fixtures/vault-preservation-v1.json'),'utf8'));
for(const p of Object.keys(PRESERVATION_FILES)) {
 mkdirSync(dirname(join(dir,p)),{recursive:true});
 writeFileSync(join(dir,p),reviewed[p]);
}
// Accelerate only the isolated fixture copy's waits, never production timing.
writeFileSync(join(dir,'scripts/release-train.mjs'),readFileSync(join(dir,'scripts/release-train.mjs'),'utf8').replace('const MIN = 60_000;', 'const MIN = 1;'));
mkdirSync(join(dir,'app'),{recursive:true});writeFileSync(join(dir,'app/VERSION'),'1.9.226');
const safe=commit('safe reviewed contract');git('remote','add','origin',dir);
let main=safe,dev=safe,calls=[],apiFailure=false,draft=false,drift=false,driftLate=false,mainReads=0;
const server=createServer((req,res)=>{
 const call={method:req.method,path:req.url,body:''};calls.push(call);req.on('data',d=>call.body+=d);
 let body={};const p=req.url;
 if(apiFailure){res.writeHead(403);res.end('{}');return;}
 if(p.endsWith('/commits/main'))body={sha:drift||(driftLate&&++mainReads>=3)?old:main};
 else if(p.endsWith('/commits/dev'))body={sha:dev};
 else if(p.includes('/compare/'))body={ahead_by:1,files:[{filename:'x'}]};
 else if(p.includes('deploy.yml/runs'))body={workflow_runs:[{id:123,status:'waiting',head_sha:safe,head_branch:'main',event:'workflow_run'}]};
 else if(p.includes('/pending_deployments'))body=[{current_user_can_approve:true,environment:{id:1,name:'production'}}];
 else if(p.includes('ci.yml/runs'))body={workflow_runs:[]};
 else if(p.includes('/pulls?'))body=[];
 else if(p.includes('/pulls/'))body={state:'open',draft,node_id:'P1',labels:[],number:7,base:{ref:'main'},head:{ref:'dev',sha:dev},mergeable_state:'clean'};
 else if(p.includes('db-backup-prod'))body={workflow_runs:[{updated_at:new Date().toISOString(),html_url:'fixture'}]};
 else if(p.includes('/commits/'))body={commit:{message:'feat: fixture'}};
 else if(p.endsWith('/graphql'))body={data:{repository:{pullRequests:{pageInfo:{hasNextPage:false},nodes:[]}}}};
 else if(req.method!=='GET'){res.writeHead(418);res.end('{}');return;}
 res.setHeader('content-type','application/json');res.end(JSON.stringify(body));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const address=`http://127.0.0.1:${server.address().port}`;
async function run(step,caller,target,{fail=false,state={},moved=false,late=false}={}){
 main=step==='deploy'?target:safe;dev=target;calls=[];apiFailure=fail;drift=moved;driftLate=late;mainReads=0;
 const path=join(dir,'state.json');writeFileSync(path,JSON.stringify({steps:[],main_sha:main,dev_sha:target,head_sha:target,release_pr:7,merge_sha:target,freeze:[],...state}));
 const child=spawn(process.execPath,['scripts/release-train.mjs',step],{cwd:dir,env:{...process.env,TRAIN_STATE:path,GITHUB_API_URL:address,GITHUB_TOKEN:'fixture',OPERATOR_TOKEN:'',APPROVER_TOKEN:late?'fixture':'',GITHUB_WORKFLOW_SHA:caller,DRY_RUN:'true',GITHUB_REF:'refs/heads/main'}});
 let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
 const code=await new Promise(r=>child.on('exit',r));return {code,output,calls:[...calls],state:JSON.parse(readFileSync(path,'utf8'))};
}
function noEffects(result){assert.ok(result.calls.every(c=>c.method==='GET'||c.path==='/graphql'&&!c.body.includes('mutation')),JSON.stringify(result.calls));}
try {
 test('snapshot matrix: old/old, old/safe, safe/old fail; safe/safe verified',()=>{
  for(const [caller,target] of [[old,old],[old,safe],[safe,old]]) assert.throws(()=>preservationPreflight({caller,target,git:(...args)=>execFileSync('git',args,{cwd:dir})}),/preservation|does not exist|exists on disk/);
  assert.equal(preservationPreflight({caller:safe,target:safe,git:(...args)=>execFileSync('git',args,{cwd:dir})}).contract,'vault-preservation-sha256-v1');
  assert.throws(()=>preservationPreflight({caller:'main',target:safe,git}),/immutable SHA/);
 });
 for(const step of ['plan','freeze','open-pr','merge','deploy']) {
  for(const [label,caller,target] of [['old caller/unsafe target',old,old],['old caller/safe target',old,safe],['safe caller/unsafe target',safe,old]]) {
   await test(`${step} executable refuses ${label} before mutation`,async()=>{const result=await run(step,caller,target);assert.equal(result.code,1);noEffects(result);});
  }
 }
 await test('marker present but preservation implementation edited fails',()=>{
  writeFileSync(join(dir,'scripts/deploy-service-key.mjs'),reviewed['scripts/deploy-service-key.mjs']+'\n// changed\n');const changed=commit('changed contract');
  assert.throws(()=>preservationPreflight({caller:safe,target:changed,git:(...args)=>execFileSync('git',args,{cwd:dir})}),/unreviewed/);
  writeFileSync(join(dir,'scripts/deploy-service-key.mjs'),reviewed['scripts/deploy-service-key.mjs']);commit('restore');
 });
 await test('additional deploy/seed Vault caller or URL write fails',()=>{
  for(const name of ['kc_service_role_key','kc_project_url']) {
   writeFileSync(join(dir,'scripts/seed-new.mjs'),`vault.update_secret(id, 'value', '${name}');`);const changed=commit('new unsafe seed');
   assert.throws(()=>preservationPreflight({caller:safe,target:changed,git:(...args)=>execFileSync('git',args,{cwd:dir})}),/Vault write path/);
  }
 });
 await test('safe/safe reaches ordinary plan gates, not a preservation failure or a write',async()=>{
  const result=await run('plan',safe,safe);assert.equal(result.code,1);noEffects(result);
  assert.equal(result.state.preservation.target,safe);assert.match(result.output,/train credentials/);assert.doesNotMatch(result.output,/unreviewed/);
 });
 await test('safe/safe freeze reaches normal freeze query',async()=>{
  const result=await run('freeze',safe,safe);assert.equal(result.code,0);assert.match(result.output,/no PR had auto-merge/);
 });
 await test('missing ref/blob fails closed',async()=>{const result=await run('freeze','a'.repeat(40),safe);assert.equal(result.code,1);noEffects(result);});
 await test('ref drift fails closed',async()=>{const result=await run('merge',safe,safe,{moved:true});assert.equal(result.code,1);noEffects(result);assert.match(result.output,/moved/);});
 await test('production approval rechecks immutable refs after waiting and refuses late drift',async()=>{const result=await run('deploy',safe,safe,{late:true});assert.equal(result.code,1);noEffects(result);assert.match(result.output,/moved/);assert.ok(result.calls.some(c=>c.path.includes('/pending_deployments')));});
 await test('API failure fails closed',async()=>{const result=await run('freeze',safe,safe,{fail:true});assert.equal(result.code,1);noEffects(result);});
 await test('unfreeze keeps a newly Draft PR held without mutation',async()=>{draft=true;const result=await run('unfreeze',safe,safe,{state:{freeze:[{number:7,armed:true,addLabel:true}]}});assert.equal(result.code,0);noEffects(result);draft=false;});
} finally {server.close();rmSync(dir,{recursive:true,force:true});}
