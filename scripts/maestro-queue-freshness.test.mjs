import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFreshness, checkFreshness } from './maestro-queue-freshness.mjs';
const sha = 'a'.repeat(40), other = 'b'.repeat(40);
const ref = `gh-readonly-queue/dev/pr-2707-${other}`;
const event = {name:'merge_group', baseRef:'refs/heads/dev', headRef:`refs/heads/${ref}`, sha};
const current = [{ref:`refs/heads/${ref}`, object:{sha}}];
const env = {GITHUB_EVENT_NAME:event.name, MERGE_GROUP_BASE_REF:event.baseRef,
 MERGE_GROUP_HEAD_REF:event.headRef, MERGE_GROUP_HEAD_SHA:sha, GITHUB_REPOSITORY:'KarmaCummunity/KC'};
test('exact ref plus SHA is current',()=>assert.equal(classifyFreshness(event,current).status,'current'));
test('missing exact ref is stale even if another queue ref has the same SHA',()=>assert.equal(classifyFreshness(event,[{...current[0],ref:current[0].ref+'-other'}]).status,'stale'));
test('replaced SHA is stale',()=>assert.equal(classifyFreshness(event,[{...current[0],object:{sha:other}}]).status,'stale'));
test('wrong branch, invalid SHA and missing identity cannot pass',()=>{
 for(const patch of [{headRef:'refs/heads/gh-readonly-queue/main/pr-2707-x'},{sha:''},{baseRef:''},{headRef:''},{headRef:'refs/heads/gh-readonly-queue/dev/pr-malformed'}])
  assert.equal(classifyFreshness({...event,...patch},current).status,'unverifiable');
});
test('duplicate ref and malformed response are unverifiable',()=>{
 assert.equal(classifyFreshness(event,[...current,...current]).status,'unverifiable');
 assert.equal(classifyFreshness(event,{}).status,'unverifiable');
});
test('API denial does not fail open',async()=>assert.equal((await checkFreshness(env,async()=>{throw Error('403')})).status,'unverifiable'));
test('other callers never query queue or change their verdict',async()=>assert.equal((await checkFreshness({...env,GITHUB_EVENT_NAME:'push'},async()=>{throw Error('must not call')})).status,'not-applicable'));
test('membership is checked again after a wait, not cached from acquisition',async()=>{
 let refs=current;const gh=async()=>refs;
 assert.equal((await checkFreshness(env,gh)).status,'current');refs=[];
 assert.equal((await checkFreshness(env,gh)).status,'stale');
});
import { readFileSync } from 'node:fs';
const workflow=readFileSync(new URL('../.github/workflows/ci-maestro-android.yml',import.meta.url),'utf8');
test('workflow checks after exclusive acquisition, after slot wait, and after native flows',()=>{
 const emu=workflow.split('  android-e2e:')[1];const positions=[...emu.matchAll(/run: node scripts\/maestro-queue-freshness\.mjs/g)].map(m=>m.index);
 assert.equal(positions.length,3);assert.ok(positions[0] < emu.indexOf('Install pinned guard-script dependencies'));
 assert.ok(positions[1] > emu.indexOf('Wait for a kc-dev test slot'));assert.ok(positions[1] < emu.indexOf('Run Maestro flows on the emulator'));
 assert.ok(positions[2] > emu.indexOf('script: bash scripts/maestro-run-android.sh'));assert.ok(positions[2] < emu.indexOf('Remove unsafe automatic media'));
 assert.ok(!emu.includes('continue-on-error: true'));assert.ok(emu.includes('queue: max'));
});
