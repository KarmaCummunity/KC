import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildInventory} from './db-usage-inventory.mjs';
import {rows,edgeFunctions,packages} from './app-migration-map.rows.mjs';
test('every current inventory object has exactly one authored row and none are stale',()=>{
 const used=new Set(buildInventory().entries.map(e=>e.kind+':'+e.name));
 const authored=rows.map(r=>r.kind+':'+r.old);
 assert.equal(new Set(authored).size,authored.length);
 assert.deepEqual([...new Set(authored)].sort(),[...used].sort());
});
test('new import and identity edge invokes have authored edge targets and implementation packages',()=>{
 for(const [name,area] of [['extract-external-post','imports'],['identity-verification-session','identityVerification']]){
  const r=rows.find(r=>r.kind==='edge_function'&&r.old===name);assert.ok(r);assert.deepEqual(r.to,['edge:'+name]);
  assert.ok(edgeFunctions.some(e=>e.name===name));assert.ok(packages.some(p=>p.select({...r,areas:[area],launch:'core'})));
 }
});
test('static CI checks generated migration map freshness',()=>{
 const yaml=readFileSync(new URL('../.github/workflows/ci-static-guards.yml',import.meta.url),'utf8');assert.match(yaml,/node scripts\/app-migration-map\.mjs --check/);
});
test('multiline no-argument generated function does not consume return fields',async()=>{
 const {parseTypes}=await import('./app-migration-map.mjs');
 const types=parseTypes('export type Database = {\n  public: {\n    Functions: {\n      example: {\n        Args: never\n        Returns: {\n          status: string\n        }[]\n      }\n    }\n  }\n}');
 assert.deepEqual(types.functions.example[0].args,{});
});
test('dev seed targets bind file, symbol, signature and baseline absence',async()=>{
 const {buildMap}=await import('./app-migration-map.mjs');
 const path='supabase/seed/demo/lib/80_admin_rpcs.sql';const original=readFileSync(new URL('../'+path,import.meta.url),'utf8');
 const names=['admin_demo_data_status','admin_wipe_demo_data_step','admin_seed_demo_data_step'];
 const seedRows=rows.filter(r=>names.includes(r.old));
 const inventory={entries:names.map(name=>({kind:'rpc',name,file:'adapter.ts',line:1,area:'admin'}))};
 const newTypes={functions:{},tables:{},views:{}};
 const build=(sql,types=newTypes)=>buildMap({rows:seedRows,missing:[],packages:[{id:'seed',select:()=>true}],edgeFunctions:[],notes:[],sourceFiles:{[path]:sql}},inventory,newTypes,types,{functions:{},grants:{}});
 assert.deepEqual(build(original).problems,[]);
 assert.ok(build(null).problems.length>=3);
 for(const name of names)assert.ok(build(original.replace('function public.'+name,'function public.changed_'+name)).problems.some(p=>p.includes(name)));
 assert.ok(build(original.replace('p_password text default null','p_password text')).problems.some(p=>p.includes('admin_seed_demo_data_step')));
 assert.ok(build(original.replaceAll('returns jsonb','returns text')).problems.length>=3);
 assert.ok(build('/* '+original+' */').problems.length>=3);
 assert.ok(build(original.split('\n').map(l=>'-- '+l).join('\n')).problems.length>=3);
 assert.ok(build(original,{...newTypes,functions:{admin_demo_data_status:[]}}).problems.some(p=>p.includes('unexpectedly present')));
});

test('current targets carry explicit SQL or edge sources and structured unknown errors',async()=>{
 const {currentSourceBinding}=await import('./app-migration-map.mjs');
 assert.equal(currentSourceBinding('rpc','test',{ 'x.sql':'-- create function public.test() returns jsonb language sql as $$ $$;'}),null);
 assert.equal(currentSourceBinding('rpc','test',{'x.sql':'/* create function public.test() returns jsonb language sql as $$ $$; */'}),null);
 const b=currentSourceBinding('rpc','test',{'x.sql':'create function public.test() returns jsonb language sql as $$ $$;'});
 assert.equal(b.source,'x.sql');assert.match(b.sqlSignature,/test\(\) → jsonb/);assert.equal(b.errorBinding.status,'unknown');
 const map=JSON.parse(readFileSync(new URL('../docs/db/app-migration-map.json',import.meta.url),'utf8'));
 const additions=rows.filter(r=>r.currentBinding);assert.equal(additions.length,26);
 for(const r of additions){const out=map.rows.find(x=>x.kind===r.kind&&x.old===r.old);assert.ok(out.targets[0].source);assert.equal(out.targets[0].errorBinding.status,'unknown');}
});

test('effective source uses sorted migration precedence, not first schema match',async()=>{
 const {currentSourceBinding}=await import('./app-migration-map.mjs');
 const declaration=args=>'create or replace function public.target('+args+') returns jsonb language sql as $$ select null $$;';
 const sources={
  'supabase/migrations/0099_override.sql':declaration('p_latest text'),
  'supabase/schemas/10_base.sql':declaration(''),
  'supabase/migrations/0001_baseline.sql':declaration('p_old integer'),
  'supabase/migrations/0080_middle.sql':declaration('p_middle uuid'),
 };
 const binding=currentSourceBinding('rpc','target',sources);
 assert.equal(binding.source,'supabase/migrations/0099_override.sql');assert.match(binding.sqlSignature,/p_latest text/);
 assert.deepEqual(currentSourceBinding('rpc','target',Object.fromEntries(Object.entries(sources).reverse())),binding);
 assert.match(currentSourceBinding('rpc','target',{'supabase/migrations/0099_override.sql':declaration('p_first text')+'\n'+declaration('p_second uuid')}).sqlSignature,/p_second uuid/);
});


test('production-copy targets bind exact seed definitions and deny baseline leakage',async()=>{
 const {buildMap}=await import('./app-migration-map.mjs');
 const path='supabase/seed/prod-copy/lib/60_admin_rpcs.sql';
 const sql=readFileSync(new URL('../'+path,import.meta.url),'utf8');
 const names=['admin_prod_copy_status','admin_delete_prod_copy'];
 const selected=rows.filter(r=>names.includes(r.old));
 const inventory={entries:names.map(name=>({kind:'rpc',name,file:'adapter.ts',line:1,area:'admin'}))};
 const types={functions:{},tables:{},views:{}};
 const build=(text,newTypes=types)=>buildMap({rows:selected,missing:[],packages:[{id:'copy',select:()=>true}],edgeFunctions:[],notes:[],sourceFiles:{[path]:text}},inventory,types,newTypes,{functions:{},grants:{}});
 assert.deepEqual(build(sql).problems,[]);
 assert.ok(build(null).problems.length>=2);
 for(const name of names)assert.ok(build(sql.replace('function public.'+name,'function public.changed_'+name)).problems.some(p=>p.includes(name)));
 assert.ok(build(sql.replaceAll('returns jsonb','returns text')).problems.length>=2);
 assert.ok(build('/* '+sql+' */').problems.length>=2);
 assert.ok(build(sql,{...types,functions:{admin_prod_copy_status:[]}}).problems.some(p=>p.includes('unexpectedly present')));
});
