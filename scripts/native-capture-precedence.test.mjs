import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {parseAllDocuments} from 'yaml';
import {requireCaptureOutputs} from './maestro-native-capture-media.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const flows=['07-create-post-form','19-edit-profile-keyboard-toolbar'];
// Maestro 2.12 Env.withEnv prepends DefineVariablesCommand. Actual run44903276560
// recorded CLI true then flow false. Model that ordered assignment, not merge precedence.
// https://raw.githubusercontent.com/mobile-dev-inc/maestro/cli-2.12.0/maestro-orchestra-models/src/main/java/maestro/orchestra/util/Env.kt
for(const flow of flows)test(flow+' preserves explicit CLI safety and defaults closed',()=>{
 const [config,commands]=parseAllDocuments(read('.maestro/flows/'+flow+'.yaml')).map(d=>d.toJSON());
 assert.equal(config.env?.KC_NATIVE_CAPTURE_SAFE,undefined);
 const blocks=commands.filter(c=>c.runFlow?.when?.true);
 assert.equal(blocks.length,flow.startsWith('07')?1:2);
 for(const value of [undefined,'false','true','TRUE','1']){
  const context={...(value===undefined?{}:{KC_NATIVE_CAPTURE_SAFE:value}),...config.env};
  for(const b of blocks){
   const condition=b.runFlow.when.true.slice(2,-1);
   assert.equal(vm.runInNewContext(condition,context),value==='true');
   assert.deepEqual(Object.keys(b.runFlow.commands[0]),['assertVisible']);
   assert.match(b.runFlow.commands[0].assertVisible.id,/^native-(create|profile)-capture-safe$/);
   assert.equal(typeof b.runFlow.commands[1].takeScreenshot,'string');
  }
 }
});
test('safe output validation requires all named real PNG headers, unsafe mode adds no retention',()=>{
 const root=mkdtempSync(join(tmpdir(),'kc-safe-outputs-'));
 const label=flows[1];const dir=join(root,'captures',label,'takeScreenshot');mkdirSync(dir,{recursive:true});
 const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(1080,16);png.writeUInt32BE(2400,20);
 try{
  assert.doesNotThrow(()=>requireCaptureOutputs(root,label,'false'));
  assert.throws(()=>requireCaptureOutputs(root,label,'true'),/missing/);
  writeFileSync(join(dir,'861-profile-input-focused.png'),png);
  assert.throws(()=>requireCaptureOutputs(root,label,'true'),/missing/);
  writeFileSync(join(dir,'861-profile-keyboard-dismissed.png'),png);
  assert.doesNotThrow(()=>requireCaptureOutputs(root,label,'true'));
  writeFileSync(join(dir,'861-profile-input-focused.png'),'not an image');
  assert.throws(()=>requireCaptureOutputs(root,label,'true'),/Invalid/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('runner propagates missing capture failure and capture-only is explicit synthetic-only',()=>{
 const script=read('scripts/maestro-run-android.sh');
 assert.match(script,/if ! node .*maestro-native-capture-media\.mjs.*"\$capture_safe"; then\n    status=1/);
 assert.match(script,/KC_MAESTRO_CAPTURE_ONLY:-false/);
 assert.match(script,/\[\[ "\$capture_safe" == true \]\] \|\|/);
 assert.match(script,/flows=\(\.maestro\/flows\/07-create-post-form.yaml \.maestro\/flows\/19-edit-profile-keyboard-toolbar.yaml\)/);
 const safety=read('app/apps/mobile/src/lib/nativeCaptureSafety.ts');
 assert.match(safety,/session.email === 'user1@seed.kc.test'/);
 assert.match(safety,/!form.loading/);assert.match(safety,/draftPhase === 'none'/);
});

test('hosted Maestro helper step selects capture regressions after pinned dependencies',()=>{
 const workflow=read('.github/workflows/ci-maestro-android.yml');
 const command=workflow.split('\n').find(line=>line.includes('run: node --test scripts/maestro-dev-env.test.mjs'));
 for(const name of ['native-capture-safety','native-success-captures','native-capture-media','native-capture-precedence']) assert.ok(command?.includes('scripts/'+name+'.test.mjs'));
 assert.ok(workflow.indexOf('npm ci --prefix scripts --ignore-scripts --no-audit --no-fund')<workflow.indexOf(command));
});
