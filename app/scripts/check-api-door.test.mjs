import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compare, findingsIn } from './check-api-door.mjs';

test('an adapter wrapped with viaApi is not a finding', () => {
  const source = "repo ??= viaApi('user', new SupabaseUserRepository(getSupabaseClient({ storage })));";

  assert.deepEqual(findingsIn(source), []);
});

test('an adapter wrapped across a line break is not a finding', () => {
  const source = "const repo = viaApi(\n  'rideBooking',\n  new SupabaseRideBookingRepository(client),\n);";

  assert.deepEqual(findingsIn(source), []);
});

test('an unwrapped adapter is a finding, including an Edge Function service', () => {
  const source = 'const a = new SupabaseUserRepository(client);\nconst b = new EdgeFnTranslationService(client);';

  assert.deepEqual(findingsIn(source), ['new SupabaseUserRepository', 'new EdgeFnTranslationService']);
});

test('only the adapter right after viaApi counts as wrapped', () => {
  const source = "const a = viaApi('user', new SupabaseUserRepository(c)); const b = new SupabasePostRepository(c);";

  assert.deepEqual(findingsIn(source), ['new SupabasePostRepository']);
});

test('a direct table or function call is a finding', () => {
  const source = "await client.from('karma_ledger').select('*');\nawait client\n  .rpc('api_my_pro_status');";

  assert.deepEqual(findingsIn(source), [".from('karma_ledger')", ".rpc('api_my_pro_status')"]);
});

test('a storage bucket and unrelated from() calls are not findings', () => {
  const source = "client.storage.from('post-images').upload(path, body);\nArray.from(set);\nBuffer.from('abc');";

  assert.deepEqual(findingsIn(source), []);
});

test('compare reports new bypasses and entries whose code is gone', () => {
  const known = new Map([
    ['a.ts: new SupabaseX', 'phase 6'],
    ['b.ts: new SupabaseY', 'phase 9'],
  ]);

  assert.deepEqual(compare(['a.ts: new SupabaseX', 'c.ts: new SupabaseZ'], known), {
    unexpected: ['c.ts: new SupabaseZ'],
    stale: ['b.ts: new SupabaseY'],
  });
  assert.deepEqual(compare(['a.ts: new SupabaseX', 'b.ts: new SupabaseY'], known), { unexpected: [], stale: [] });
});
