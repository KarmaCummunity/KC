// Execute the actual workflow shell against an isolated local git remote. No network/credentials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { parse } from 'yaml';
const workflow = parse(readFileSync(new URL('../.github/workflows/bump-version-on-merge.yml', import.meta.url),'utf8'));
const assignScript = workflow.jobs.bump.steps.find(s=>s.name==='Assign registry and migration IDs immediately').run;
const script = workflow.jobs.checkpoint.steps.find(s=>s.name==='Commit the eligible VERSION-only checkpoint').run;
const realGit = execFileSync('which',['git'],{encoding:'utf8'}).trim();
function fixture() {
 const root=mkdtempSync(join(tmpdir(),'kc-bump-race-'));const remote=join(root,'remote.git'),work=join(root,'work'),rival=join(root,'rival');
 const git=(cwd,...args)=>execFileSync(realGit,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git(root,'init','--bare',remote);git(root,'clone',remote,work);
 for(const name of ['scripts','app','supabase/migrations'])mkdirSync(join(work,name),{recursive:true});
 writeFileSync(join(work,'app/VERSION'),'1.0.0\n');
 cpSync(new URL('./bump-app-version.mjs',import.meta.url),join(work,'scripts/bump-app-version.mjs'));
 for(const name of ['spec-ids','migration-ids','app-migration-map'])writeFileSync(join(work,'scripts/'+name+'.mjs'),'// fixture: no placeholders\n');
 git(work,'config','user.name','fixture');git(work,'config','user.email','fixture@example.invalid');
 git(work,'add','.');git(work,'commit','-m','initial');git(work,'branch','-M','dev');git(work,'push','origin','dev');
 git(root,'clone','--branch','dev',remote,rival);git(rival,'config','user.name','fixture');git(rival,'config','user.email','fixture@example.invalid');
 const commit=(cwd,path,value,message)=>{mkdirSync(dirname(join(cwd,path)),{recursive:true});writeFileSync(join(cwd,path),value);git(cwd,'add',path);git(cwd,'commit','-m',message);return git(cwd,'rev-parse','HEAD');};
 const trigger=commit(work,'feature.txt','first','merge first');git(work,'push','origin','dev');git(rival,'pull','--ff-only');
 return {root,remote,work,rival,git,commit,trigger,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
function run(f,{race,assignOnly=false}={}) {
 const bin=join(f.root,'bin');mkdirSync(bin,{recursive:true});
 // Sleep is irrelevant to local rejection tests. The git wrapper only injects one rival push.
 writeFileSync(join(bin,'sleep'),'#!/bin/sh\nexit 0\n',{mode:0o755});
 if(race) {
  const rivalScript=join(f.root,'race.sh');writeFileSync(rivalScript,race,{mode:0o755});
  writeFileSync(join(bin,'git'),`#!/bin/bash\nif [[ "$1" == push && ! -e '${f.root}/raced' ]]; then\n touch '${f.root}/raced'\n bash '${rivalScript}'\nfi\nexec '${realGit}' "$@"\n`,{mode:0o755});
 }
 const checkpoint=f.git(f.work,'log','-1','--format=%H','--','app/VERSION');
 const result=spawnSync('bash',['-c',assignOnly ? assignScript : script],{cwd:f.work,encoding:'utf8',env:{...process.env,EXPECTED_CHECKPOINT:checkpoint,GITHUB_OUTPUT:join(f.root,'outputs'),PATH:bin+':'+process.env.PATH},timeout:20000});
 assert.equal(result.status,0,result.stderr+'\n'+result.stdout);
 return result;
}
test('one ordinary merge produces one VERSION-only child',()=>{
 const f=fixture();try{run(f);assert.equal(readFileSync(join(f.work,'app/VERSION'),'utf8'),'1.0.1\n');assert.equal(f.git(f.work,'rev-parse','HEAD^'),f.trigger);assert.equal(f.git(f.work,'show','--format=','--name-only','HEAD'),'app/VERSION');}finally{f.cleanup();}
});
test('queued stale merge run sees an already bumped fresh tip and adds no second bump',()=>{
 const f=fixture();try{const bump=f.commit(f.rival,'app/VERSION','1.0.1\n','chore(release): bump app version to 1.0.1 [skip ci]');f.git(f.rival,'push','origin','dev');run(f);assert.equal(f.git(f.work,'rev-parse','HEAD'),bump);}finally{f.cleanup();}
});
test('rejected push racing another bump retries without a duplicate VERSION child',()=>{
 const f=fixture();try{
 const race=`cd '${f.rival}'\nprintf '1.0.1\\n' > app/VERSION\n'${realGit}' add app/VERSION\n'${realGit}' commit -m 'chore(release): bump app version to 1.0.1 [skip ci]'\n'${realGit}' push origin dev\n`;
 run(f,{race});assert.equal(readFileSync(join(f.work,'app/VERSION'),'utf8'),'1.0.1\n');assert.equal(f.git(f.work,'rev-parse','HEAD'),f.git(f.rival,'rev-parse','HEAD'));
 }finally{f.cleanup();}
});
test('fresh explicit VERSION edit wins even when trigger checkout had no VERSION edit',()=>{
 const f=fixture();try{const manual=f.commit(f.rival,'app/VERSION','2.0.0\n','release minor');f.git(f.rival,'push','origin','dev');run(f);assert.equal(f.git(f.work,'rev-parse','HEAD'),manual);}finally{f.cleanup();}
});
test('new substantive merge after previous bump receives its own single bump',()=>{
 const f=fixture();try{f.commit(f.rival,'app/VERSION','1.0.1\n','chore(release): bump app version to 1.0.1 [skip ci]');const newer=f.commit(f.rival,'second.txt','second','merge second');f.git(f.rival,'push','origin','dev');f.git(f.work,'fetch','origin','dev');f.git(f.work,'reset','--hard','origin/dev');run(f);assert.equal(readFileSync(join(f.work,'app/VERSION'),'utf8'),'1.0.2\n');assert.equal(f.git(f.work,'rev-parse','HEAD^'),newer);}finally{f.cleanup();}
});
test('rejected push racing a substantive merge retries on that merge and keeps one version child',()=>{
 const f=fixture();try{
 const race=`cd '${f.rival}'\nprintf second > newer.txt\n'${realGit}' add newer.txt\n'${realGit}' commit -m 'merge newer'\n'${realGit}' push origin dev\n`;
 run(f,{race});assert.equal(readFileSync(join(f.work,'app/VERSION'),'utf8'),'1.0.1\n');assert.equal(f.git(f.work,'rev-parse','HEAD^'),f.git(f.rival,'rev-parse','HEAD'));
 }finally{f.cleanup();}
});
test('a fresh VERSION tip still assigns IDs without adding a second bump',()=>{
 const f=fixture();try{
 const ids=`import {existsSync,writeFileSync,unlinkSync} from 'node:fs';if(existsSync('pending-id')){writeFileSync('assigned-id','ID1');unlinkSync('pending-id');}`;
 f.commit(f.rival,'scripts/spec-ids.mjs',ids,'fixture assigner');f.commit(f.rival,'pending-id','placeholder','merge placeholder');f.commit(f.rival,'app/VERSION','1.0.1\n','chore(release): bump app version to 1.0.1 [skip ci]');f.git(f.rival,'push','origin','dev');
 run(f,{assignOnly:true});assert.equal(readFileSync(join(f.work,'app/VERSION'),'utf8'),'1.0.1\n');assert.equal(readFileSync(join(f.work,'assigned-id'),'utf8'),'ID1');assert.equal(f.git(f.work,'log','-1','--format=%s'),'chore(release): assign spec ids');
 }finally{f.cleanup();}
});
test('a stale waiter cannot add a checkpoint over a changed explicit VERSION',()=>{
 const f=fixture();try{
 f.commit(f.work,'app/VERSION','2.0.0\n','explicit release');f.git(f.work,'push','origin','dev');f.git(f.rival,'pull','--ff-only');const newer=f.commit(f.rival,'another.txt','new','merge newer');f.git(f.rival,'push','origin','dev');f.git(f.work,'reset','--hard',f.trigger);run(f);assert.equal(f.git(f.work,'rev-parse','HEAD'),newer);assert.equal(readFileSync(join(f.work,'app/VERSION'),'utf8'),'2.0.0\n');
 }finally{f.cleanup();}
});

// Queue occupancy must never suppress an eligible checkpoint.
// A group is a `gh-readonly-queue/dev/pr-<N>-<base sha>` ref on the remote.
const queueRef = (pr, base) => `refs/heads/gh-readonly-queue/dev/pr-${pr}-${base}`;

/** Push a merge group that still waits behind the landed merge: a commit that is not on dev. */
function pushWaitingGroup(f, pr) {
  const base = f.git(f.rival, 'rev-parse', 'HEAD');
  f.git(f.rival, 'checkout', '--detach');
  const head = f.commit(f.rival, `queued-${pr}.txt`, 'queued', `queued pr ${pr}`);
  f.git(f.rival, 'push', 'origin', `${head}:${queueRef(pr, base)}`);
  f.git(f.rival, 'checkout', 'dev');
  return { ref: queueRef(pr, base), head };
}

test('an eligible checkpoint bumps even with a continuously busy queue', () => {
  const f = fixture();
  try {
    pushWaitingGroup(f, 7);
    run(f);
    assert.equal(readFileSync(join(f.work,'app/VERSION'),'utf8'),'1.0.1\n');
    assert.equal(f.git(f.work,'rev-parse','HEAD^'),f.trigger);
  } finally { f.cleanup(); }
});

test('the landed merge\'s own group ref, not removed yet, does not defer the bump', () => {
  const f = fixture();
  try {
    f.git(f.rival, 'push', 'origin', `${f.trigger}:${queueRef(5, 'a'.repeat(40))}`);
    run(f);
    assert.equal(readFileSync(join(f.work, 'app/VERSION'), 'utf8'), '1.0.1\n');
    assert.equal(f.git(f.work, 'rev-parse', 'HEAD^'), f.trigger);
  } finally { f.cleanup(); }
});

test('an ID commit is pushed immediately while the separate checkpoint waiter coalesces', () => {
  const f = fixture();
  try {
    const ids = "import { existsSync, renameSync } from 'node:fs'; if (existsSync('pending-id')) renameSync('pending-id', 'assigned-id');\n";
    f.commit(f.rival, 'scripts/spec-ids.mjs', ids, 'fixture assigner');
    f.commit(f.rival, 'pending-id', 'placeholder', 'merge placeholder');
    f.git(f.rival, 'push', 'origin', 'dev');
    pushWaitingGroup(f, 9);
    run(f,{assignOnly:true});
    assert.equal(f.git(f.work, 'log', '-1', '--format=%s'), 'chore(release): assign spec ids');
    assert.equal(readFileSync(join(f.work, 'app/VERSION'), 'utf8'), '1.0.0\n');
  } finally { f.cleanup(); }
});

test('assignment refreshes generated migration source map before staging the same commit', () => {
 const f=fixture();try {
  f.commit(f.rival,'docs/db/shadow-map.json','pending','fixture tracked map');
  f.commit(f.rival,'scripts/app-migration-map.mjs',"import {writeFileSync} from 'node:fs';writeFileSync('docs/db/shadow-map.json','numbered');",'fixture map generator');
  f.git(f.rival,'push','origin','dev');run(f,{assignOnly:true});
  assert.equal(f.git(f.work,'show','HEAD:docs/db/shadow-map.json'),'numbered');
  assert.equal(f.git(f.work,'log','-1','--format=%s'),'chore(release): assign spec ids');
 }finally{f.cleanup();}
});
