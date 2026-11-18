import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KC_DEV_REF, assertDevProject, createApi, createSql, fileFor, runProof } from './e2e-account-purge.mjs';

const MEMBER = '11111111-2222-4333-8444-555555555555';
const BUCKETS = [
  { id: 'avatars', allowed: ['image/jpeg'] },
  { id: 'chat-media', allowed: ['image/jpeg', 'image/png', 'image/webp'] },
];

/**
 * An in-memory project. `faults` switch on what a broken purge would do:
 *   keepFile        the purge leaves one file behind
 *   keepIdentity    the purge leaves the auth identity
 *   eagerDelete     deactivating the account already removes a file (breaks AC2)
 *   notPending      the purge date cannot be moved
 */
function fakeProject(faults = {}) {
  const files = new Map(BUCKETS.map((b) => [b.id, new Set()]));
  const state = { member: null, due: false, calls: [], removed: [], deletedMember: false };
  const api = {
    async createMember() {
      state.calls.push('createMember');
      state.member = MEMBER;
      return MEMBER;
    },
    async memberExists() {
      return state.member !== null;
    },
    async deleteMember() {
      state.deletedMember = true;
      state.member = null;
    },
    async signIn() {
      state.calls.push('signIn');
      return 'member-token';
    },
    async requestDeletion(token) {
      state.calls.push(`requestDeletion:${token}`);
      if (faults.eagerDelete) files.get('avatars').clear();
    },
    async buckets() {
      return BUCKETS;
    },
    async upload(bucket, path) {
      state.calls.push(`upload:${bucket}`);
      files.get(bucket).add(path);
    },
    async listAll(bucket, prefix) {
      return [...files.get(bucket)].filter((path) => path.startsWith(`${prefix}/`));
    },
    async remove(bucket, paths) {
      state.removed.push(...paths.map((path) => `${bucket}/${path}`));
      for (const path of paths) files.get(bucket).delete(path);
    },
    async purge() {
      state.calls.push('purge');
      if (!state.due) return { status: 200, json: { ok: true, purged: 0, failed: 0 } };
      for (const [bucket, set] of files) {
        for (const path of [...set]) if (!(faults.keepFile && bucket === 'chat-media')) set.delete(path);
      }
      if (!faults.keepIdentity) state.member = null;
      return { status: 200, json: { ok: true, purged: 1, failed: 0 } };
    },
  };
  const sql = {
    makeDue(userId) {
      state.calls.push(`makeDue:${userId}`);
      if (faults.notPending) return false;
      state.due = true;
      return true;
    },
  };
  return { api, sql, state, files };
}

const run = (project) => runProof({ api: project.api, sql: project.sql, log: () => {}, stamp: 1, password: 'pw' });

test('passes when the purge empties every bucket and removes the identity, in the documented order', async () => {
  const project = fakeProject();
  assert.deepEqual(await run(project), { buckets: 2, files: 3 });
  assert.deepEqual(project.state.calls, [
    'createMember',
    'upload:avatars',
    'upload:avatars',
    'upload:chat-media',
    'signIn',
    'requestDeletion:member-token',
    `makeDue:${MEMBER}`,
    'purge',
  ]);
  // Nothing to clean up after a real purge.
  assert.deepEqual(project.state.removed, []);
  assert.equal(project.state.deletedMember, false);
});

test('fails when a file survives the purge, names it, and cleans up after itself', async () => {
  const project = fakeProject({ keepFile: true });
  await assert.rejects(run(project), /AC4: 1 files are still in storage after the purge: chat-media\/11111111/);
  assert.equal(project.files.get('chat-media').size, 0);
  assert.ok(project.state.removed.some((path) => path.startsWith('chat-media/')));
});

test('fails when the auth identity survives the purge, and removes the member', async () => {
  const project = fakeProject({ keepIdentity: true });
  await assert.rejects(run(project), /AC4: the auth identity still exists/);
  assert.equal(project.state.deletedMember, true);
});

test('fails when deactivating the account already deletes a file (AC2), before any purge', async () => {
  const project = fakeProject({ eagerDelete: true });
  await assert.rejects(run(project), /AC2: 2 files vanished/);
  assert.ok(!project.state.calls.includes('purge'));
  assert.equal(project.state.deletedMember, true);
});

test('fails without calling the purge when the purge date could not be moved', async () => {
  const project = fakeProject({ notPending: true });
  await assert.rejects(run(project), /not pending deletion/);
  assert.ok(!project.state.calls.includes('purge'));
  assert.equal(project.state.deletedMember, true);
});

test('repeats a purge call that did not answer, and gives up after three', async () => {
  const flaky = fakeProject();
  const purge = flaky.api.purge;
  let n = 0;
  flaky.api.purge = async () => ((n += 1) === 1 ? { status: 504, json: null } : purge());
  assert.deepEqual(await run(flaky), { buckets: 2, files: 3 });

  const down = fakeProject();
  down.api.purge = async () => ({ status: 503, json: null });
  await assert.rejects(run(down), /did not succeed \(last answer: HTTP 503\)/);
  assert.equal(down.state.deletedMember, true);
});

test('refuses any project but kc-dev', () => {
  const db = `postgresql://postgres.${KC_DEV_REF}@pooler.example:6543/postgres`;
  assert.doesNotThrow(() => assertDevProject(`https://${KC_DEV_REF}.supabase.co`, db));
  assert.throws(() => assertDevProject('https://abcdefghijklmnopqrst.supabase.co', db), /not the kc-dev API/);
  assert.throws(() => assertDevProject(`https://${KC_DEV_REF}.supabase.co.evil.example`, db), /not the kc-dev API/);
  assert.throws(() => assertDevProject(`https://${KC_DEV_REF}.supabase.co`, 'postgresql://postgres.other@pooler.example/postgres'), /database address/);
});

test('plants a file of a type the bucket allows', () => {
  assert.equal(fileFor(null).contentType, 'image/png');
  assert.equal(fileFor(['image/jpeg', 'image/png']).contentType, 'image/png');
  assert.equal(fileFor(['image/jpeg']).contentType, 'image/jpeg');
  assert.equal(fileFor(['application/pdf']).contentType, 'application/pdf');
});

test('the api sends member calls with the public key and the member token, never the service key', async () => {
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ url, headers: init.headers, body: init.body });
    return new Response(JSON.stringify({ access_token: 'member-token', id: MEMBER }), { status: 200 });
  };
  const api = createApi({ supabaseUrl: 'https://x.supabase.co', anonKey: 'anon', serviceKey: 'service', fetch });
  await api.requestDeletion(await api.signIn('a@seed.kc.test', 'pw'));
  await api.createMember('a@seed.kc.test', 'pw');
  assert.deepEqual(seen.map((c) => [new URL(c.url).pathname, c.headers.apikey, c.headers.Authorization]), [
    ['/auth/v1/token', 'anon', 'Bearer anon'],
    ['/rest/v1/rpc/request_account_deletion', 'anon', 'Bearer member-token'],
    ['/auth/v1/admin/users', 'service', 'Bearer service'],
  ]);
});

test('an API error names the step and the status, never the answer body', async () => {
  const fetch = async () => new Response('secret detail from the server', { status: 500 });
  const api = createApi({ supabaseUrl: 'https://x.supabase.co', anonKey: 'anon', serviceKey: 'service', fetch });
  await assert.rejects(api.buckets(), (error) => error.message === 'list buckets: HTTP 500');
});

test('the identity counts as gone only on a clear 404', async () => {
  const answer = (status) => createApi({ supabaseUrl: 'https://x.supabase.co', anonKey: 'anon', serviceKey: 'service', fetch: async () => new Response('{}', { status }) });
  assert.equal(await answer(200).memberExists(MEMBER), true);
  assert.equal(await answer(404).memberExists(MEMBER), false);
  await assert.rejects(answer(503).memberExists(MEMBER), /look up member: HTTP 503/);
});

test('the listing walks sub-folders and pages', async () => {
  const pages = {
    'u:0': [...Array.from({ length: 100 }, (_, i) => ({ name: `f${i}.png`, id: `id${i}` }))],
    'u:100': [{ name: 'chat', id: null }],
    'u/chat:0': [{ name: 'deep.png', id: 'x' }],
  };
  const fetch = async (_url, init) => {
    const { prefix, offset } = JSON.parse(init.body);
    return new Response(JSON.stringify(pages[`${prefix}:${offset}`] ?? []), { status: 200 });
  };
  const api = createApi({ supabaseUrl: 'https://x.supabase.co', anonKey: 'anon', serviceKey: 'service', fetch });
  const paths = await api.listAll('avatars', 'u');
  assert.equal(paths.length, 101);
  assert.ok(paths.includes('u/chat/deep.png'));
});

test('the purge date is moved for one validated user id, passed to psql as a variable', () => {
  const calls = [];
  const run = (cmd, args, options) => {
    calls.push({ cmd, args, input: options.input });
    return { status: 0, stdout: '1\n', stderr: '' };
  };
  const sql = createSql({ dbUrl: 'postgresql://db', run });
  assert.equal(sql.makeDue(MEMBER), true);
  assert.equal(calls[0].cmd, 'psql');
  assert.ok(calls[0].args.includes(`uid=${MEMBER}`));
  assert.ok(!calls[0].input.includes(MEMBER), 'the id is not spliced into the SQL text');
  assert.match(calls[0].input, /where user_id = :'uid' and status = 'pending_deletion'/);
  assert.throws(() => sql.makeDue("x'; drop table users; --"), /not a user id/);
  assert.equal(createSql({ dbUrl: 'postgresql://db', run: () => ({ status: 0, stdout: '', stderr: '' }) }).makeDue(MEMBER), false);
  assert.throws(() => createSql({ dbUrl: 'postgresql://db', run: () => ({ status: 2, stdout: '', stderr: 'boom\nmore' }) }).makeDue(MEMBER), /psql exited with 2: boom/);
});
