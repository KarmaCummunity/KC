// Execute the actual workflow shell against an isolated local git remote. No network/credentials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { parse } from 'yaml';
const workflow = parse(readFileSync(new URL('../.github/workflows/bump-version-on-merge.yml', import.meta.url),'utf8'));
const script = workflow.jobs.assign.steps.find(s=>s.name==='Assign spec ids and push to dev').run;
const realGit = execFileSync('which',['git'],{encoding:'utf8'}).trim();
function fixture() {
 const root=mkdtempSync(join(tmpdir(),'kc-ids-race-'));const remote=join(root,'remote.git'),work=join(root,'work'),rival=join(root,'rival');
 const git=(cwd,...args)=>execFileSync(realGit,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git(root,'init','--bare',remote);git(root,'clone',remote,work);
 for(const name of ['scripts','app','supabase/migrations'])mkdirSync(join(work,name),{recursive:true});
 writeFileSync(join(work,'app/VERSION'),'1.0.0\n');
 for(const name of ['spec-ids','migration-ids'])writeFileSync(join(work,'scripts/'+name+'.mjs'),'// fixture: no placeholders\n');
 git(work,'config','user.name','fixture');git(work,'config','user.email','fixture@example.invalid');
 git(work,'add','.');git(work,'commit','-m','initial');git(work,'branch','-M','dev');git(work,'push','origin','dev');
 git(root,'clone','--branch','dev',remote,rival);git(rival,'config','user.name','fixture');git(rival,'config','user.email','fixture@example.invalid');
 const commit=(cwd,path,value,message)=>{mkdirSync(dirname(join(cwd,path)),{recursive:true});writeFileSync(join(cwd,path),value);git(cwd,'add',path);git(cwd,'commit','-m',message);return git(cwd,'rev-parse','HEAD');};
 const trigger=commit(work,'feature.txt','first','merge first');git(work,'push','origin','dev');git(rival,'pull','--ff-only');
 return {root,remote,work,rival,git,commit,trigger,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
function run(f,{race}={}) {
 const bin=join(f.root,'bin');mkdirSync(bin,{recursive:true});
 // Sleep is irrelevant to local rejection tests. The git wrapper only injects one rival push.
 writeFileSync(join(bin,'sleep'),'#!/bin/sh\nexit 0\n',{mode:0o755});
 if(race) {
  const rivalScript=join(f.root,'race.sh');writeFileSync(rivalScript,race,{mode:0o755});
  writeFileSync(join(bin,'git'),`#!/bin/bash\nif [[ "$1" == push && ! -e '${f.root}/raced' ]]; then\n touch '${f.root}/raced'\n bash '${rivalScript}'\nfi\nexec '${realGit}' "$@"\n`,{mode:0o755});
 }
 const result=spawnSync('bash',['-c',script],{cwd:f.work,encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH},timeout:20000});
 assert.equal(result.status,0,result.stderr+'\n'+result.stdout);
 return result;
}
const IDS=`import {existsSync,writeFileSync,unlinkSync} from 'node:fs';if(existsSync('pending-id')){writeFileSync('assigned-id','ID'+Date.now());unlinkSync('pending-id');}`;
test('an ordinary merge with no placeholders adds no commit and never touches app/VERSION (#2613)',()=>{
 const f=fixture();try{const r=run(f);assert.equal(f.git(f.work,'rev-parse','origin/dev'),f.trigger);assert.equal(readFileSync(join(f.work,'app/VERSION'),'utf8'),'1.0.0\n');assert.match(r.stdout,/nothing to commit/);}finally{f.cleanup();}
});
test('placeholders become one CI-certified id commit (no [skip ci]) on top of the merge',()=>{
 const f=fixture();try{f.commit(f.rival,'scripts/spec-ids.mjs',IDS,'fixture assigner');const merge=f.commit(f.rival,'pending-id','placeholder','merge placeholder');f.git(f.rival,'push','origin','dev');
 run(f);assert.equal(f.git(f.work,'rev-parse','HEAD^'),merge);assert.equal(f.git(f.work,'log','-1','--format=%s'),'chore(release): assign spec ids');assert.equal(readFileSync(join(f.work,'app/VERSION'),'utf8'),'1.0.0\n');assert.equal(f.git(f.work,'rev-parse','origin/dev'),f.git(f.work,'rev-parse','HEAD'));
 }finally{f.cleanup();}
});
test('a rejected push retries on the new tip and assigns once',()=>{
 const f=fixture();try{f.commit(f.rival,'scripts/spec-ids.mjs',IDS,'fixture assigner');f.commit(f.rival,'pending-id','placeholder','merge placeholder');f.git(f.rival,'push','origin','dev');
 const race=`cd '${f.rival}'\nprintf second > newer.txt\n'${realGit}' add newer.txt\n'${realGit}' commit -m 'merge newer'\n'${realGit}' push origin dev\n`;
 run(f,{race});assert.equal(f.git(f.work,'rev-parse','HEAD^'),f.git(f.rival,'rev-parse','HEAD'));assert.equal(f.git(f.work,'log','-1','--format=%s'),'chore(release): assign spec ids');assert.equal(f.git(f.work,'rev-list','--count','--grep=assign spec ids','HEAD'),'1');
 }finally{f.cleanup();}
});
test('the workflow has no version-bump step left',()=>{
 const text=readFileSync(new URL('../.github/workflows/bump-version-on-merge.yml', import.meta.url),'utf8');
 assert.doesNotMatch(script,/bump-app-version|app\/VERSION|\[skip ci\]/);
 assert.doesNotMatch(text,/bump app version to/);
});
