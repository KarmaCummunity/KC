import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { selectServiceKey, verifiedServiceKey } from './release/service-role-key.mjs';
const ref='enbqriuxvvuontiwslun',key='sb_secret_'+ 'a'.repeat(32),other='sb_secret_'+ 'b'.repeat(32);
const rows=k=>[{name:'default',type:'secret',api_key:k}];
const reply=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
function fetcher(replies){const calls=[];return {calls,fetchImpl:async(url,opts)=>{calls.push({url,opts});const r=replies.shift();if(r instanceof Error)throw r;return r;}}}
const args=f=>({projectRef:ref,accessToken:'dummy-access-token',fetchImpl:f.fetchImpl});

test('explicit reveal, stable key, nonclaiming expected-project validation before emitting',async()=>{
 const f=fetcher([reply(rows(key)),reply(rows(key)),reply({external:{}})]);
 assert.equal(await verifiedServiceKey(args(f)),key);
 assert.deepEqual(f.calls.map(c=>c.url),[`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`,`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`,`https://${ref}.supabase.co/auth/v1/settings`]);
 assert.ok(f.calls.every(c=>c.opts.method==='GET'&&c.opts.redirect==='error'&&c.opts.signal instanceof AbortSignal));
 assert.equal(f.calls[2].opts.headers.apikey,key);
});
for(const status of [401,403,404,429,500])test(`rejects stable CLI-shaped but unusable key, HTTP${status}`,async()=>{
 const f=fetcher([reply(rows(key)),reply(rows(key)),reply({message:key},status)]);
 await assert.rejects(()=>verifiedServiceKey(args(f)),e=>!e.message.includes(key)&&/verification failed/.test(e.message));
});
test('changing existing key fails before gateway validation',async()=>{
 const f=fetcher([reply(rows(key)),reply(rows(other))]);await assert.rejects(()=>verifiedServiceKey(args(f)));assert.equal(f.calls.length,2);
});
for(const response of [reply({},401),new Error(key),{ok:true,json:async()=>{throw new Error(key)}}])test('management failure does not emit provider body or credential',async()=>{
 const f=fetcher([response]);await assert.rejects(()=>verifiedServiceKey(args(f)),e=>!e.message.includes(key));
});
for(const malformed of [null,[],{},'ok'])test('rejects unexpected auth settings shape',async()=>{
 const f=fetcher([reply(rows(key)),reply(rows(key)),reply(malformed)]);await assert.rejects(()=>verifiedServiceKey(args(f)));
});
for(const bad of [undefined,'','../../other','UPPERCASEPROJECTREFXX','https://wrong.example'])test('invalid project ref cannot select destination',async()=>{
 const f=fetcher([]);await assert.rejects(()=>verifiedServiceKey({...args(f),projectRef:bad}));assert.equal(f.calls.length,0);
});
test('missing token fails before request',async()=>{const f=fetcher([]);await assert.rejects(()=>verifiedServiceKey({...args(f),accessToken:''}));assert.equal(f.calls.length,0)});
test('prefers unique default secret, does not silently fall back from invalid default',()=>{
 const legacy={name:'service_role',type:'legacy',api_key:'eyJtest.payload.signature'};
 assert.equal(selectServiceKey([legacy,...rows(key)]),key);assert.equal(selectServiceKey([legacy]),legacy.api_key);
 assert.throws(()=>selectServiceKey([legacy,...rows('bad')]));assert.throws(()=>selectServiceKey([...rows(key),...rows(other)]));assert.throws(()=>selectServiceKey([legacy,legacy]));
});
for(const bad of [null,{},[],[{name:'anon',api_key:'eyJtest.payload.signature'}],rows('sb_secret_short'),rows(key+'\n'),rows(key+'*')])test('malformed or non-service key is rejected',()=>assert.throws(()=>selectServiceKey(bad)));
test('credential CLI refuses non-Actions runs without stdout or secret-bearing errors',()=>{
 const child=spawnSync(process.execPath,[new URL('./release/service-role-key.mjs',import.meta.url).pathname],{env:{...process.env,GITHUB_ACTIONS:'false',SUPABASE_PROJECT_REF:ref,SUPABASE_ACCESS_TOKEN:key},encoding:'utf8'});
 assert.equal(child.status,1);assert.equal(child.stdout,'');assert.ok(!child.stderr.includes(key));
});

test('both Vault writers use verified shared retrieval, never CLI no-reveal fallback',()=>{
 for(const file of ['deploy-db.yml','seed-kc-dev.yml']){
  const text=readFileSync(new URL('../.github/workflows/'+file,import.meta.url),'utf8');
  const step=text.slice(text.indexOf('      - name: '+(file==='deploy-db.yml'?'Vault secrets for':'Set the Vault secrets')),text.indexOf('SQL\n',text.indexOf('      - name: '+(file==='deploy-db.yml'?'Vault secrets for':'Set the Vault secrets')))+4);
  assert.match(step,/node scripts\/release\/service-role-key\.mjs/);assert.doesNotMatch(step,/supabase projects api-keys/);assert.match(step,/vault\.update_secret/);
 }
});
