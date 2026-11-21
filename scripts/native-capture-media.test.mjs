import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { cleanCaptureMedia } from './maestro-native-capture-media.mjs';
test('07/19 only preserve exact explicit safe PNG names, never failure/retry pixels or video',()=>{
 const root=mkdtempSync(join(tmpdir(),'native-capture-'));
 const put=p=>{const path=join(root,p);mkdirSync(path.slice(0,path.lastIndexOf('/')),{recursive:true});writeFileSync(path,'fixture');};
 try{
  const label='19-edit-profile-keyboard-toolbar-retry';
  const good=`captures/${label}/takeScreenshot/861-profile-input-focused.png`;
  const bad=[`captures/${label}/screenshots/failure.png`,`captures/${label}/takeScreenshot/unsafe861-profile-input-focused.png`,`captures/${label}/takeScreenshot/861-profile-input-focused.mp4`,`debug/${label}/861-profile-input-focused.png`,`reports/${label}/failure.jpg`,`videos/${label}.mp4`];
  [good,...bad,`debug/${label}/commands.json`,'debug/08-chat-inbox/failure.png'].forEach(put);
  assert.deepEqual(cleanCaptureMedia(root,label),{removed:6,retained:1});
  assert.ok(existsSync(join(root,good)));
  bad.forEach(p=>assert.equal(existsSync(join(root,p)),false,p));
  assert.ok(existsSync(join(root,`debug/${label}/commands.json`)));
  assert.ok(existsSync(join(root,'debug/08-chat-inbox/failure.png')));
  assert.deepEqual(cleanCaptureMedia(root,'08-chat-inbox'),{removed:0,retained:0});
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('upload requires successful pre-upload privacy cleanup even after failed runner',()=>{
 const text=readFileSync(new URL('../.github/workflows/ci-maestro-android.yml',import.meta.url),'utf8');
 assert.ok(text.includes("if: always() && steps.native-capture-privacy.outcome == 'success'"));
 assert.ok(text.indexOf('id: native-capture-privacy')<text.indexOf('name: Upload Maestro'));
});
