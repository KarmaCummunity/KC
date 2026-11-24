#!/usr/bin/env node
// End-to-end proof on kc-dev that purging a deleted account removes all of the member's media
// (FR-SETTINGS-012 AC2 and AC4, SEC-1065). The Deno and pgTAP suites cover the purge function and
// its database side with fakes and a scratch database; this script runs the real thing once:
//
//   1. creates a throwaway member (Auth admin API);
//   2. plants a file in the member's folder `<user_id>/` of every storage bucket;
//   3. deletes the account as the member (`request_account_deletion`): the grace period starts
//      and the files must still be there (AC2, "nothing is deleted yet");
//   4. moves that one account's purge date into the past (the only direct database write);
//   5. has the database start `purge-deleted-accounts` exactly as its daily job `account_purge`
//      does (`kc_private.invoke_edge_function`, with the key the database keeps in Vault), and
//      reads the worker's answer from pg_net;
//   6. fails unless every folder is empty and the auth identity is gone (AC4).
//
// Whatever happens, the member and the planted files are removed before the script exits.
// It refuses any project but kc-dev. It needs the service-role key (to create the member and to
// read and write storage as an operator) and a database connection, so it runs only inside the
// `E2E account purge (dev)` workflow, never from a laptop or a browser.
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (never printed),
//      PURGE_PROOF_DB_URL (pooler address, no password) and PGPASSWORD (read by psql).
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

/** The only project this script may touch. */
export const KC_DEV_REF = 'enbqriuxvvuontiwslun';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Folder depth walked under `<user_id>/`; the deepest layout is `<user_id>/<chat_id>/<file>`. */
const MAX_DEPTH = 3;
const PAGE = 100;

// The smallest valid images of the two types every image bucket accepts.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z',
  'base64',
);

/** Throws unless both addresses name kc-dev: the API host and the database user of the pooler. */
export function assertDevProject(supabaseUrl, dbUrl) {
  const host = new URL(supabaseUrl).hostname;
  if (host !== `${KC_DEV_REF}.supabase.co`) throw new Error(`refusing: ${host} is not the kc-dev API`);
  if (!String(dbUrl).includes(KC_DEV_REF)) throw new Error('refusing: the database address is not kc-dev');
}

/** The file to plant in a bucket: a type the bucket allows (`allowed` null means any). */
export function fileFor(allowed) {
  if (!allowed || allowed.includes('image/png')) return { name: 'purge-proof.png', contentType: 'image/png', bytes: PNG };
  if (allowed.includes('image/jpeg')) return { name: 'purge-proof.jpg', contentType: 'image/jpeg', bytes: JPEG };
  // Storage checks the declared type only, so any bytes pass under the bucket's first type.
  return { name: 'purge-proof.bin', contentType: allowed[0], bytes: PNG };
}

/** The project's HTTP APIs, each call as the service role unless a member token is given. */
export function createApi({ supabaseUrl, anonKey, serviceKey, fetch = globalThis.fetch }) {
  const call = async (path, { method = 'GET', token = serviceKey, apikey = serviceKey, body, contentType = 'application/json' } = {}) => {
    const res = await fetch(`${supabaseUrl}${path}`, {
      method,
      headers: { apikey, Authorization: `Bearer ${token}`, 'Content-Type': contentType },
      body: body === undefined || Buffer.isBuffer(body) ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // A non-JSON body stays in `text`.
    }
    return { status: res.status, json, text };
  };
  /** Like `call`, but any answer outside 2xx is an error that names the step, never a body. */
  const must = async (step, path, init) => {
    const res = await call(path, init);
    if (res.status < 200 || res.status >= 300) throw new Error(`${step}: HTTP ${res.status}`);
    return res.json;
  };
  const listPage = (bucket, prefix, offset) =>
    must(`list ${bucket}`, `/storage/v1/object/list/${bucket}`, { method: 'POST', body: { prefix, limit: PAGE, offset } });
  /** Every object path under `prefix`, walking sub-folders (a folder is an entry without an id). */
  const listAll = async (bucket, prefix, depth = MAX_DEPTH) => {
    if (depth <= 0) return [];
    const paths = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await listPage(bucket, prefix, offset);
      for (const entry of page) {
        const full = `${prefix}/${entry.name}`;
        if (entry.id === null) paths.push(...(await listAll(bucket, full, depth - 1)));
        else paths.push(full);
      }
      if (page.length < PAGE) return paths;
    }
  };
  return {
    createMember: async (email, password) =>
      (await must('create member', '/auth/v1/admin/users', { method: 'POST', body: { email, password, email_confirm: true, user_metadata: { full_name: 'Purge Proof', seed: true } } })).id,
    /** True on 200, false on 404; any other answer is an error, so a stalled API never reads as "gone". */
    memberExists: async (id) => {
      const { status } = await call(`/auth/v1/admin/users/${id}`);
      if (status !== 200 && status !== 404) throw new Error(`look up member: HTTP ${status}`);
      return status === 200;
    },
    deleteMember: (id) => call(`/auth/v1/admin/users/${id}`, { method: 'DELETE' }),
    signIn: async (email, password) =>
      (await must('sign in', '/auth/v1/token?grant_type=password', { method: 'POST', apikey: anonKey, token: anonKey, body: { email, password } })).access_token,
    requestDeletion: (memberToken) => must('request_account_deletion', '/rest/v1/rpc/request_account_deletion', { method: 'POST', apikey: anonKey, token: memberToken, body: {} }),
    buckets: async () => (await must('list buckets', '/storage/v1/bucket')).map((b) => ({ id: b.id, allowed: b.allowed_mime_types ?? null })),
    upload: (bucket, path, file) => must(`upload to ${bucket}`, `/storage/v1/object/${bucket}/${path}`, { method: 'POST', body: file.bytes, contentType: file.contentType }),
    listAll,
    remove: (bucket, paths) => call(`/storage/v1/object/${bucket}`, { method: 'DELETE', body: { prefixes: paths } }),
  };
}

/**
 * One psql statement runner. Values travel as psql variables read from stdin, so an id never
 * becomes part of the SQL text. Returns the unaligned output, trimmed.
 */
export function createPsql({ dbUrl, run = spawnSync }) {
  return (sql, vars = {}) => {
    const args = [dbUrl, '-v', 'ON_ERROR_STOP=1', '-qAt'];
    for (const [name, value] of Object.entries(vars)) args.push('-v', `${name}=${value}`);
    const out = run('psql', [...args, '-f', '-'], { input: sql, encoding: 'utf8' });
    if (out.status !== 0) throw new Error(`psql exited with ${out.status}: ${String(out.stderr).trim().split('\n')[0]}`);
    return String(out.stdout).trim();
  };
}

/** The database side of the purge proof, through psql. */
export function createSql({ dbUrl, run = spawnSync }) {
  const query = createPsql({ dbUrl, run });
  return {
    /** The one direct write: the account's purge date moves into the past. True when a row moved. */
    makeDue(userId) {
      if (!UUID.test(userId)) throw new Error('makeDue: not a user id');
      const moved = query(
        "update public.user_account set deletion_requested_at = now() - interval '31 days', deletion_purge_at = now() - interval '1 day' " +
          "where user_id = :'uid' and status = 'pending_deletion' returning 1;",
        { uid: userId },
      );
      return moved === '1';
    },
    /** Starts the worker the way the daily job does. The pg_net request id, or null when nothing was queued. */
    startPurge() {
      const id = query("select kc_private.invoke_edge_function('purge-deleted-accounts');");
      return /^\d+$/.test(id) ? id : null;
    },
    /**
     * The worker's answer to that request, as pg_net recorded it: `{ status, body }`, or null while
     * there is none. `status` is the HTTP code, `timeout` (pg_net waits 30 s) or `error`.
     */
    purgeAnswer(requestId) {
      if (!/^\d+$/.test(String(requestId))) throw new Error('purgeAnswer: not a request id');
      const row = query(
        "select coalesce(r.status_code::text, case when r.timed_out then 'timeout' else 'error' end) || ' ' || " +
          "left(regexp_replace(coalesce(r.content, r.error_msg, ''), '\\s+', ' ', 'g'), 200) from net._http_response r where r.id = :id;",
        { id: requestId },
      );
      if (row === '') return null;
      const [status, ...rest] = row.split(' ');
      return { status, body: rest.join(' ') };
    },
  };
}

/** Polls pg_net for the worker's answer; pg_net itself stops waiting after 30 s. */
async function waitForPurgeAnswer(sql, requestId, sleep, tries = 30) {
  for (let i = 0; i < tries; i += 1) {
    const answer = sql.purgeAnswer(requestId);
    if (answer) return answer;
    await sleep(2000);
  }
  return { status: 'error', body: 'pg_net recorded no answer within a minute' };
}

/** Objects still under the member's folder, as `bucket/path`, over every bucket. */
async function leftovers(api, buckets, memberId) {
  const found = [];
  for (const bucket of buckets) found.push(...(await api.listAll(bucket.id, memberId)).map((path) => `${bucket.id}/${path}`));
  return found;
}

/**
 * Runs the proof. Resolves to what it checked; rejects with the first thing that was wrong.
 * `api` and `sql` are the two ports above, so the self-test runs it against fakes.
 */
export async function runProof({
  api,
  sql,
  log = console.log,
  stamp = Date.now(),
  password = randomBytes(24).toString('base64url'),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const email = `purge-proof-${stamp}@seed.kc.test`;
  const planted = [];
  let memberId = null;
  try {
    memberId = await api.createMember(email, password);
    if (!UUID.test(String(memberId))) throw new Error('create member: no user id in the answer');
    const buckets = await api.buckets();
    if (buckets.length === 0) throw new Error('the project has no storage bucket: nothing would be checked');
    for (const [index, bucket] of buckets.entries()) {
      const file = fileFor(bucket.allowed);
      // The first bucket also gets a nested file, like a chat image (`<user_id>/<chat_id>/<file>`).
      const paths = index === 0 ? [`${memberId}/${file.name}`, `${memberId}/nested/${file.name}`] : [`${memberId}/${file.name}`];
      for (const path of paths) {
        await api.upload(bucket.id, path, file);
        planted.push({ bucket: bucket.id, path });
      }
    }
    log(`planted ${planted.length} files in ${buckets.length} buckets`);

    await api.requestDeletion(await api.signIn(email, password));
    const kept = await leftovers(api, buckets, memberId);
    if (kept.length !== planted.length) throw new Error(`AC2: ${planted.length - kept.length} files vanished when the account was only deactivated`);

    if (!sql.makeDue(memberId)) throw new Error('the account was not pending deletion, so its purge date could not be moved');
    const requestId = sql.startPurge();
    if (!requestId) throw new Error('the database did not queue the purge call (pg_net or the Vault secrets are missing)');
    const answer = await waitForPurgeAnswer(sql, requestId, sleep);
    log(`the worker answered the database: ${answer.status} ${answer.body}`);
    // `timeout` is pg_net giving up after 30 s, not the worker's verdict; the checks below decide.
    // Any other answer than 200 is the worker refusing the database's key, or failing.
    if (answer.status !== '200' && answer.status !== 'timeout') {
      throw new Error(`the purge worker answered ${answer.status} to the database's own call: ${answer.body}`);
    }

    // After a timeout the worker may still be at work: the identity gets two minutes to go.
    let exists = await api.memberExists(memberId);
    for (let i = 0; exists && answer.status === 'timeout' && i < 24; i += 1) {
      await sleep(5000);
      exists = await api.memberExists(memberId);
    }
    const left = await leftovers(api, buckets, memberId);
    if (left.length > 0) throw new Error(`AC4: ${left.length} files are still in storage after the purge: ${left.join(', ')}`);
    if (exists) throw new Error('AC4: the auth identity still exists after the purge');
    const checked = { buckets: buckets.length, files: planted.length };
    memberId = null;
    planted.length = 0;
    return checked;
  } finally {
    // Reached with something left only when a step failed: remove what this run created.
    for (const { bucket, path } of planted) await Promise.resolve(api.remove(bucket, [path])).catch(() => undefined);
    if (memberId) await Promise.resolve(api.deleteMember(memberId)).catch(() => undefined);
  }
}

async function main(env) {
  const supabaseUrl = (env.SUPABASE_URL ?? '').replace(/\/$/, '');
  const dbUrl = env.PURGE_PROOF_DB_URL ?? '';
  for (const name of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'PURGE_PROOF_DB_URL']) {
    if (!env[name]) throw new Error(`${name} is not set`);
  }
  assertDevProject(supabaseUrl, dbUrl);
  const api = createApi({ supabaseUrl, anonKey: env.SUPABASE_ANON_KEY, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY });
  const checked = await runProof({ api, sql: createSql({ dbUrl }) });
  console.log(`account purge proof passed: ${checked.files} files in ${checked.buckets} buckets removed, identity gone`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.env).catch((error) => {
    console.error(`::error::account purge proof failed: ${error.message}`);
    process.exit(1);
  });
}
