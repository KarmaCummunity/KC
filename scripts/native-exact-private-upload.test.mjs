import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, truncateSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateCapability, uploadEvidence, MAX_BYTES } from './native-exact-private-upload.mjs';
const candidate = '02cf8dc342de36ad8e229f6537d5ea10c0a0dfc0';
const token = (claims) => 'e30.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.signature';
const cap = (claims = {}, changes = {}) => JSON.stringify({candidate,url: 'https://enbqriuxvvuontiwslun.supabase.co/storage/v1/object/upload/sign/kc-native-evidence/'+'a'.repeat(32)+'/evidence.cms?token='+token({exp:Math.floor(Date.now()/1000)+7200,...claims}),...changes});
test('allows only pinned HTTPS isolated object capability', () => assert.ok(validateCapability(cap()).expires));
test('rejects changed audience, object, candidate and parameters', () => {
 for (const url of ['https://evil.invalid/a','http://enbqriuxvvuontiwslun.supabase.co/a',JSON.parse(cap()).url+'&other=1',JSON.parse(cap()).url.replace('kc-native-evidence','avatars')]) assert.throws(()=>validateCapability(cap({}, {url})));
 assert.throws(()=>validateCapability(cap({}, {candidate:'wrong'})));
});
test('fails closed before build for short expiry and overwrite token',()=>{
 assert.throws(()=>validateCapability(cap({exp:1})));
 assert.throws(()=>validateCapability(cap({upsert:true})));
 assert.throws(()=>validateCapability(cap({exp:Math.floor(Date.now()/1000)+500}),Date.now(),6000));
});
test('uploads ciphertext once with no redirect or broad credentials',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'kc-upload-')); const file=join(dir,'test.cms');writeFileSync(file,Buffer.from([1,2,3]));
 try {let calls=0;const result=await uploadEvidence(cap(),file,async(url,opt)=>{calls++;assert.equal(opt.redirect,'error');assert.equal(opt.method,'PUT');assert.equal(opt.headers['content-type'],'application/octet-stream');assert.equal(opt.headers.authorization,undefined);assert.equal(opt.headers['x-upsert'],'false');return new Response('{}',{status:200});});assert.equal(calls,1);assert.equal(result.bytes,3);
 await assert.rejects(uploadEvidence(cap(),file,async()=>new Response('private server detail',{status:403})),/Private evidence upload failed/);
 truncateSync(file,MAX_BYTES+1);await assert.rejects(uploadEvidence(cap(),file),/size/);
 truncateSync(file,0);await assert.rejects(uploadEvidence(cap(),file),/size/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
