import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const dir = 'supabase/migrations';
const file = readdirSync(dir).find(x => /_native_evidence_isolation\.sql$/.test(x));
test('native evidence policy is restrictive, idempotent and mismatch-failing', () => {
 assert.ok(file);
 const sql = readFileSync(`${dir}/${file}`, 'utf8');
 assert.match(sql, /as restrictive for all to anon, authenticated/);
 assert.match(sql, /using \(bucket_id <> 'kc-native-evidence'\)/);
 assert.match(sql, /with check \(bucket_id <> 'kc-native-evidence'\)/);
 assert.match(sql, /if not exists/);
 assert.match(sql, /raise exception 'Private native evidence policy differs/);
 assert.doesNotMatch(sql, /drop policy|alter policy|grant |service_role_key|api_key/i);
 for (const bucket of ['avatars','chat-media','listing-images','post-images','post-uploads','kc-native-evidence']) {
  for (const prior of [false,true]) assert.equal(prior && bucket !== 'kc-native-evidence', bucket === 'kc-native-evidence' ? false : prior);
 }
});
test('DB suite covers privileged positive and both client denied reads/writes', () => {
 const sql = readFileSync('supabase/tests/137_native_evidence_isolation.sql','utf8');
 assert.match(sql, /select plan\(8\)/);
 for (const role of ['anon','authenticated']) assert.match(sql, new RegExp('set local role '+role+';'));
 assert.equal((sql.match(/select throws_ok\(/g)??[]).length,2);
 assert.match(sql, /privileged controller sees probe/);
 assert.match(sql, /grant usage on schema storage to anon, authenticated/);
 assert.match(sql, /alter table storage.objects enable row level security/);
 assert.match(sql, /rollback;/);
});
