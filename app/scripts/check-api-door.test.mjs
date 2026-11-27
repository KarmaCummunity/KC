import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compare, findingsIn, withoutComments } from './check-api-door.mjs';

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

test('a bucket addressed on a client is a finding, once per file, and never mistaken for a table', () => {
  const source = "client.storage.from('post-images').upload(path, body);\nawait getSupabaseClient().storage\n  .from(BUCKET).remove([path]);";

  assert.deepEqual(findingsIn(source), ['storage.from()']);
});

test('unrelated from() calls are not findings', () => {
  assert.deepEqual(findingsIn("Array.from(set);\nBuffer.from('abc');"), []);
});

test('a storage address built by hand is a finding', () => {
  assert.deepEqual(findingsIn('return `${base}/storage/v1/object/public/${bucket}/${path}`;'), ['storage URL']);
  assert.deepEqual(findingsIn("if (!url.includes('/storage/v1/render/image/')) return url;"), ['storage URL']);
});

test('an Edge Function invoked on a client is a finding', () => {
  assert.deepEqual(findingsIn("await client.functions.invoke('translate', { body });"), ['functions.invoke()']);
  assert.deepEqual(findingsIn("await client.functions\n  .invoke(name);"), ['functions.invoke()']);
});

test('a session call on a client is a finding, named by its method', () => {
  const source = 'const { data } = await getSupabaseClient().auth.getSession();\nawait client.auth\n  .signOut();\nawait client.auth.getSession();';

  assert.deepEqual(findingsIn(source), ['.auth.getSession()', '.auth.signOut()']);
  // The client's `auth` held in a variable is the same door.
  assert.deepEqual(findingsIn('const auth = client.auth;\nawait auth.refreshSession();'), ['.auth.refreshSession()']);
});

test('text that only looks like a session call is not a finding', () => {
  assert.deepEqual(findingsIn("return i18n.t('errors.auth.unknown');\nconst auth = options.auth.mode;"), []);
  // The app's own auth store shares the name and is not Supabase.
  assert.deepEqual(findingsIn('const auth = useAuthStore();\nauth.setOnboardingState(next);'), []);
});

test('a pattern inside a comment is not a finding; an address inside a string still is', () => {
  const commented = "// Why not client.storage.from(b).upload(): it cannot be aborted.\n/* POST /storage/v1/object/<bucket>/<path>\n   as the member: client.auth.getSession() */\nconst a = 1; // supabase.channel(topic)";
  const address = "const url = 'https://kc.test/storage/v1/object/public/a.jpg';";

  assert.deepEqual(findingsIn(commented), []);
  assert.deepEqual(findingsIn(address), ['storage URL']);
  assert.equal(withoutComments("const u = 'http://a/b'; // note"), "const u = 'http://a/b'; ");
});

test('scanning one file does not change what is found in the next', () => {
  const source = 'client.storage.from(BUCKET);';

  assert.deepEqual(findingsIn(source), ['storage.from()']);
  assert.deepEqual(findingsIn(source), ['storage.from()']);
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

test('a wire name with a digit still counts as wrapped', () => {
  assert.deepEqual(findingsIn("const repo = viaApi('chatV2', new SupabaseChatV2Repository(client));"), []);
});

test('a realtime adapter built on viaApiRealtime is not a finding; one built on the bare client is', () => {
  assert.deepEqual(findingsIn("const a = new SupabaseChatRealtime(viaApiRealtime(supabase), readTotal);"), []);
  assert.deepEqual(findingsIn("const a = new SupabaseOnlinePresence(\n  viaApiRealtime(supabase),\n);"), []);
  assert.deepEqual(findingsIn("const a = new SupabaseChatRealtime(supabase);"), ['new SupabaseChatRealtime']);
});

test('a channel opened on the Supabase client itself is a finding; one opened through the realtime door is not', () => {
  assert.deepEqual(findingsIn("const c = supabase\n  .channel(topic, { config: { private: true } });"), ['supabase.channel()']);
  assert.deepEqual(findingsIn("const c = viaApiRealtime(supabase).channel(topic);"), []);
  assert.deepEqual(findingsIn("const c = getSupabaseClient().channel(topic);"), ['supabase.channel()']);
  assert.deepEqual(findingsIn("const c = viaApiRealtime(getSupabaseClient())\n  .channel(topic);"), []);
});
