import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('successful native captures are under the existing uploaded output directory',()=>{
 const runner=read('scripts/maestro-run-android.sh');
 assert.ok(runner.includes('"$OUT_DIR/captures"'));
 assert.ok(runner.includes('--test-output-dir \"$OUT_DIR/captures/$label\"'));
 const workflow=read('.github/workflows/ci-maestro-android.yml');
 assert.match(workflow,/path: \$\{\{ runner.temp \}\}\/maestro/);
 assert.match(workflow,/if: always\(\)/);
});
test('capture state assertions remain required and precede successful-state screenshots',()=>{
 for(const [file,selector] of [['07-create-post-form.yaml','create-post-screen'],['19-edit-profile-keyboard-toolbar.yaml','edit-profile-save']]){
  const flow=read('.maestro/flows/'+file);
  assert.ok(flow.indexOf('id: '+selector)<flow.indexOf('- takeScreenshot:'));
  assert.match(flow,/- takeScreenshot: 861-/);
  assert.doesNotMatch(flow,/optional: true/);
 }
 assert.ok(read('scripts/maestro-run-android.sh').includes('KC_NATIVE_CAPTURE_SAFE=$capture_safe'));
 assert.doesNotMatch(read('.maestro/flows/01-auth-email-sign-in.yaml'),/takeScreenshot/);
 const profile=read('.maestro/flows/19-edit-profile-keyboard-toolbar.yaml');
 assert.ok(profile.indexOf('861-profile-input-focused')<profile.indexOf('- hideKeyboard'));
 assert.ok(profile.indexOf('861-profile-keyboard-dismissed')>profile.indexOf('- hideKeyboard'));
});
