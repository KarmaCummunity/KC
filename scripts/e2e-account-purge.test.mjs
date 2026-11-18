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
 *   notQueued       the database cannot start the worker (no pg_net or Vault secret)
 *   refused         the worker refuses the database's key
 *   slow            pg_net stops waiting before the worker is done; the purge lands two polls later
 */
function fakeProject(faults = {}) {
  const files = new Map(BUCKETS.map((b) => [b.id, new Set()]));
  const state = { member: null, due: false, calls: [], removed: [], deletedMember: false, pendingPurge: 0 };
  const api = {
    async createMember() {
      state.calls.push('createMember');
      state.member = MEMBER;
      return MEMBER;
    },
    async memberExists() {
      // A slow worker finishes while the proof is still polling.
      if (state.pendingPurge > 0 && (state.pendingPurge -= 1) === 0) purgeNow();
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
  };
  /** What the worker does for a due account. */
  function purgeNow() {
    if (!state.due) return;
    for (const [bucket, set] of files) {
      for (const path of [...set]) if (!(faults.keepFile && bucket === 'chat-media')) set.delete(path);
    }
    if (!faults.keepIdentity) state.member = null;
  }
  const sql = {
    makeDue(userId) {
      state.calls.push(`makeDue:${userId}`);
      if (faults.notPending) return false;
      state.due = true;
      return true;
    },
    startPurge() {
      state.calls.push('startPurge');
      return faults.notQueued ? null : '7';
    },
    purgeAnswer(requestId) {
      state.calls.push(`purgeAnswer:${requestId}`);
      // The first poll finds nothing yet; the second has the answer.
      if ((state.polls = (state.polls ?? 0) + 1) === 1) return null;
      if (faults.refused) return { status: '401', body: '{"ok":false,"error":"unauthenticated"}' };
      if (faults.slow) {
        state.pendingPurge = 2;
        return { status: 'timeout', body: '' };
      }
      purgeNow();
      return { status: '200', body: '{"ok":true,"purged":1,"failed":0}' };
    },
  };
  return { api, sql, state, files };
}

const run = (project) => runProof({ api: project.api, sql: project.sql, log: () => {}, stamp: 1, password: 'pw', sleep: async () => {} });

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
    'startPurge',
    'purgeAnswer:7',
    'purgeAnswer:7',
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
  assert.ok(!project.state.calls.includes('startPurge'));
  assert.equal(project.state.deletedMember, true);
});

test('fails without starting the purge when the purge date could not be moved', async () => {
  const project = fakeProject({ notPending: true });
  await assert.rejects(run(project), /not pending deletion/);
  assert.ok(!project.state.calls.includes('startPurge'));
  assert.equal(project.state.deletedMember, true);
});

test('fails when the database cannot start the worker', async () => {
  const project = fakeProject({ notQueued: true });
  await assert.rejects(run(project), /did not queue the purge call/);
  assert.equal(project.state.deletedMember, true);
});

test('fails with the worker\'s own answer when it refuses the database\'s key', async () => {
  const project = fakeProject({ refused: true });
  await assert.rejects(run(project), /answered 401 to the database's own call: \{"ok":false,"error":"unauthenticated"\}/);
  assert.equal(project.state.deletedMember, true);
});

test('a pg_net timeout is not a verdict: the proof waits for the worker and still checks the result', async () => {
  assert.deepEqual(await run(fakeProject({ slow: true })), { buckets: 2, files: 3 });
  // A worker that timed out and never finished still fails on what it left.
  const stuck = fakeProject({ slow: true, keepIdentity: true });
  await assert.rejects(run(stuck), /AC4: the auth identity still exists/);
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

test('the worker is started through the job\'s own function, and its answer is read from pg_net', () => {
  const answers = ['42\n', '', '200 {"ok":true,"purged":1,"failed":0}\n', 'timeout \n'];
  const inputs = [];
  const sql = createSql({
    dbUrl: 'postgresql://db',
    run: (_cmd, args, options) => {
      inputs.push({ args, input: options.input });
      return { status: 0, stdout: answers.shift(), stderr: '' };
    },
  });
  assert.equal(sql.startPurge(), '42');
  assert.match(inputs[0].input, /kc_private\.invoke_edge_function\('purge-deleted-accounts'\)/);
  assert.equal(sql.purgeAnswer('42'), null);
  assert.deepEqual(sql.purgeAnswer('42'), { status: '200', body: '{"ok":true,"purged":1,"failed":0}' });
  assert.deepEqual(sql.purgeAnswer('42'), { status: 'timeout', body: '' });
  assert.ok(inputs[1].args.includes('id=42'));
  assert.match(inputs[1].input, /from net\._http_response r where r\.id = :id/);
  assert.throws(() => sql.purgeAnswer('42; drop'), /not a request id/);
  // Nothing queued: the function returned null, which psql prints as an empty line.
  assert.equal(createSql({ dbUrl: 'postgresql://db', run: () => ({ status: 0, stdout: '\n', stderr: '' }) }).startPurge(), null);
});
