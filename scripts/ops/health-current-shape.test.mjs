import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planAlertActions, renderAlert, alertMarker } from './health-alerts.mjs';
import { runMonitor } from './health-monitor.mjs';
const link = 'https://example.test/runbook';
const current = (status='failing', extra={}) => ({ check_name:'edge_function_responses', status, measured:42, max_allowed:0, detail:'42 worker 4xx responses', failure_means:'Workers are not accepting database calls', ...extra });
test('current baseline failing row opens a named alert with all actual fields',()=>{
 const [a]=planAlertActions('dev',[current()],[],link);
 assert.equal(a.type,'open'); assert.equal(a.checkKey,'edge_function_responses');
 for(const v of ['42','0','Database-started worker requests failed']) assert.ok(a.alert.body.includes(v));
 assert.ok(!a.alert.body.includes('undefined'));
});
test('current unchanged failure is deduplicated, threshold and value changes update',()=>{
 const old=current(); const open=[{id:4,body:renderAlert('dev',old,link).body}];
 assert.deepEqual(planAlertActions('dev',[old],open,link),[]);
 for(const extra of [{max_allowed:9},{measured:43}]) assert.equal(planAlertActions('dev',[current('failing',extra)],open,link)[0].type,'update');
});
test('current ok resolves; skipped neither opens nor resolves an existing incident',()=>{
 const open=[{id:4,body:alertMarker('dev','edge_function_responses')}];
 assert.equal(planAlertActions('dev',[current('ok')],open,link)[0].type,'resolve');
 assert.deepEqual(planAlertActions('dev',[current('skipped')],open,link),[]);
 assert.deepEqual(planAlertActions('dev',[current('skipped')],[],link),[]);
});
test('monitor names only failing checks from current SQL rows',async()=>{
 const actions=[]; const report=[current(),{...current('skipped'),check_name:'not_measured'},{...current('ok'),check_name:'healthy'}];
 const summary=await runMonitor({env:'dev',supabase:{projectStatus:async()=> 'ACTIVE_HEALTHY',hasHealthChecks:async()=>true,healthReport:async()=>report},channels:[{name:'fake',listOpen:async()=>[],apply:async a=>{actions.push(a);return 'done';}}],runbookUrl:link});
 assert.deepEqual(summary.failing,['edge_function_responses=failing']); assert.equal(actions.length,1);
});
test('unreadable or malformed reports do not close existing incidents',async()=>{
 for(const report of [null,{},[{status:'failing'}],[current('unexpected')],[current('failing',{measured:null})]]){
  const actions=[];
  const summary=await runMonitor({env:'dev',supabase:{projectStatus:async()=> 'ACTIVE_HEALTHY',hasHealthChecks:async()=>true,healthReport:async()=>report},channels:[{name:'fake',listOpen:async()=>[{id:8,body:alertMarker('dev','edge_function_responses')}],apply:async a=>{actions.push(a);return 'done';}}],runbookUrl:link});
  assert.deepEqual(summary.failing,['health_report_unavailable=error']);
  assert.deepEqual(actions.map(a=>a.type),['open']);
 }
});
test('SQL declaration and representative fixture agree on the report contract',async()=>{
 const {readFile}=await import('node:fs/promises');
 const sql=await readFile(new URL('../../supabase/schemas/95_platform/080_health_checks.sql',import.meta.url),'utf8');
 assert.match(sql,/returns table \(check_name text, status text, measured bigint, max_allowed bigint, detail text, failure_means text\)/);
 assert.deepEqual(Object.keys(current()),['check_name','status','measured','max_allowed','detail','failure_means']);
});
test('malformed legacy rows cannot falsely recover an incident',async()=>{
 for(const report of [[{check_key:'edge_function_responses',status:'ok'}],[{check_key:'edge_function_responses',status:'error'}]]){
  const actions=[];
  const summary=await runMonitor({env:'dev',supabase:{projectStatus:async()=> 'ACTIVE_HEALTHY',hasHealthChecks:async()=>true,healthReport:async()=>report},channels:[{name:'fake',listOpen:async()=>[{id:8,body:alertMarker('dev','edge_function_responses')}],apply:async a=>{actions.push(a);return 'done';}}],runbookUrl:link});
  assert.deepEqual(summary.failing,['health_report_unavailable=error']); assert.deepEqual(actions.map(a=>a.type),['open']);
 }
});
test('external API errors and exception prose never enter public issue payloads',async()=>{
 const {supabaseManagement}=await import('./health-monitor.mjs');
 const privateText='private diagnostic sample must not be published';
 for(const fail of [async()=>{throw new Error(privateText);},async()=>({ok:false,status:500,text:async()=>privateText})]){
  const actions=[];
  const summary=await runMonitor({env:'dev',supabase:supabaseManagement({projectRef:'test',token:'test',fetchImpl:fail}),channels:[{name:'fake',listOpen:async()=>[],apply:async a=>{actions.push(a);return 'done';}}],runbookUrl:link});
  assert.equal(actions.length,1);assert.ok(!JSON.stringify(actions).includes(privateText));assert.ok(!JSON.stringify(summary).includes(privateText));
 }
});
test('large bigint strings remain exact and current dynamic detail stays private',()=>{
 const huge='9007199254740993';
 const [a]=planAlertActions('dev',[current('failing',{measured:huge,max_allowed:'9007199254740992',detail:'private member diagnostic'})],[],link);
 assert.ok(a.alert.body.includes(huge)); assert.ok(a.alert.body.includes('9007199254740992'));
 assert.ok(!JSON.stringify(a).includes('private member diagnostic'));
});
test('invalid or imprecise count values reject the whole report',()=>{
 for(const value of [Number.MAX_SAFE_INTEGER+1,'1.5','-1','1e20','9223372036854775808',{},Infinity]) assert.throws(()=>planAlertActions('dev',[current('failing',{measured:value})],[],link));
});

test('dynamic legacy and configured meaning prose stay out of public bodies and markers',()=>{
 for (const r of [current('failing',{failure_means:'PRIVATE_SENTINEL',detail:'PRIVATE_SENTINEL'}),{check_key:'legacy',area:'platform',severity:'warning',status:'alert',value:1,threshold:0,detail:'PRIVATE_SENTINEL',failure_means:'PRIVATE_SENTINEL'}]) assert.ok(!JSON.stringify(planAlertActions('dev',[r],[],link)).includes('PRIVATE_SENTINEL'));
});

test('all baseline registered checks have fixed impact summaries, unknown names stay explicit',async()=>{
 const {readFile}=await import('node:fs/promises');
 const {HEALTH_IMPACTS,safeHealthImpact}=await import('./health-impacts.mjs');
 const sql=await readFile(new URL('../../supabase/schemas/95_platform/080_health_checks.sql',import.meta.url),'utf8');
 const registry=sql.split('-- The number each check measures')[0];
 const names=[...registry.matchAll(/\('([a-z0-9_]+)',/g)].map(x=>x[1]);
 assert.equal(names.length,12); assert.deepEqual(Object.keys(HEALTH_IMPACTS).filter(n=>!['import_provider_budget','whatsapp_outbound_backlog'].includes(n)).sort(),names.sort());
 assert.match(safeHealthImpact('jobs_late'),/has not succeeded/);
 assert.match(safeHealthImpact('unknown_check'),/no reviewed impact mapping/);
 const [a]=planAlertActions('dev',[current('failing',{check_name:'unknown_check',failure_means:'PRIVATE_SENTINEL'})],[],link);
 assert.match(a.alert.body,/no reviewed impact mapping/); assert.ok(!a.alert.body.includes('PRIVATE_SENTINEL'));
});
test('legacy freeform area is never rendered',()=>{
 const [a]=planAlertActions('dev',[{check_key:'legacy',status:'alert',area:'PRIVATE_AREA_SENTINEL',severity:'warning',value:1,threshold:0,detail:'private'}],[],link);
 assert.ok(!JSON.stringify(a).includes('PRIVATE_AREA_SENTINEL'));assert.match(a.alert.body,/\(platform\)/);
});

test('extension checks have fixed impacts grounded in their migrations',async()=>{
 const {readFile}=await import('node:fs/promises');const {safeHealthImpact}=await import('./health-impacts.mjs');
 for(const [name,file] of [['import_provider_budget','0076_import_telemetry.sql'],['whatsapp_outbound_backlog','0057_whatsapp_match_alerts_and_jobs.sql']]){
  const sql=await readFile(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8');assert.ok(sql.includes("('"+name+"',"));assert.ok(!safeHealthImpact(name).includes('no reviewed impact mapping'));
 }
});
test('safe impact participates in the public fingerprint without config prose',()=>{
 const [a]=planAlertActions('dev',[current('failing',{failure_means:'PRIVATE_SENTINEL'})],[],link);
 const marker=a.alert.body.split('\n').find(l=>l.startsWith('<!-- ops-state:'));assert.match(marker,/Database-started worker requests/);assert.ok(!marker.includes('PRIVATE_SENTINEL'));
});
