#!/usr/bin/env node
// End-to-end proof on kc-dev that a member's post photo reaches other members only as a copy without
// metadata (FR-POST-005 AC4, NFR-PRIV-002, KC#2316). The Deno and pgTAP suites cover the worker and
// its database side with fakes and a scratch database; this script runs the real pipeline once:
//
//   1. creates two throwaway members, an owner and a viewer (Auth admin API), and activates them
//      (a fresh account is `pending_verification`; the pipeline makes no copy for an inactive owner);
//   2. creates one open post of the owner (database fixture);
//   3. as the owner, uploads a JPEG carrying a GPS block to the owner's folder, with its `-thumb`,
//      and records the photo row the way the app does (REST insert, `pending`);
//   4. waits for the database to start `process-post-media` (the insert queues the job and kicks the
//      worker; the minute job is the safety net) and for the row to become `ready`;
//   5. as the viewer, reads the post (`post_detail`): the photo must be the copy under
//      `derived/<owner>/`, and the copy and its thumb, fetched from the public URL, must not contain
//      the GPS block.
//
// Whatever happens, the post, the files and both members are removed before the script exits. It
// refuses any project but kc-dev. It needs the service-role key and a database connection, so it
// runs only inside the `E2E post photos (dev)` workflow.
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (never printed),
//      PROOF_DB_URL (pooler address, no password) and PGPASSWORD (read by psql).
import { randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { assertDevProject, createApi, createPsql } from './e2e-account-purge.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = 'post-images';
/** A marker no sanitized copy may contain. */
export const GPS_MARKER = 'GPS-PROOF-32.0853N-34.7818E';

/** The smallest valid JPEG (1 × 1) with an APP1 "Exif" segment carrying the marker, right after SOI. */
export function jpegWithGps() {
  const jpeg = Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z',
    'base64',
  );
  const payload = Buffer.from(`Exif\0\0${GPS_MARKER}`, 'latin1');
  const app1 = Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 255]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, payload, jpeg.subarray(2)]);
}

/** `a/b/c.jpg` → `a/b/c-thumb.jpg`, the app's and the worker's thumb naming. */
export const thumbOf = (key) => key.replace(/(\.[A-Za-z0-9]+)?$/, (ext) => `-thumb${ext}`);

/** Throws unless `bytes` is a whole JPEG without the marker. */
export function assertClean(label, bytes) {
  if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error(`${label}: not a JPEG`);
  if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) throw new Error(`${label}: does not end at EOI`);
  if (bytes.includes(Buffer.from(GPS_MARKER, 'latin1'))) throw new Error(`${label}: the GPS block reached other members`);
}

/** The database fixture and reads; `query` is a psql runner (createPsql: values never enter the SQL text). */
export function createPhotoSql(query) {
  const id = (value, what) => {
    if (!UUID.test(String(value))) throw new Error(`${what}: not an id`);
    return value;
  };
  return {
    /** A fresh account is `pending_verification`; the pipeline makes copies for active owners only. */
    activate(userId) {
      const moved = query("update public.user_account set status = 'active' where user_id = :'uid' and status = 'pending_verification' returning 1;",
        { uid: id(userId, 'activate') });
      if (moved !== '1') throw new Error('activate: the account was not pending verification');
    },
    /** One open request of the items world, public, in the first city: a post any member can read. */
    createPost(ownerId) {
      return id(query(
        "insert into public.posts (owner_id, world_slug, kind_id, direction, status, visibility, title, city_id) " +
          "select :'uid', 'items', k.id, 'request', 'open', 'Public', 'post photo proof', (select c.city_id from public.cities c order by c.city_id limit 1) " +
          "from public.post_kinds k where k.world_slug = 'items' and k.direction in ('request', 'either') order by k.slug limit 1 returning id;",
        { uid: id(ownerId, 'createPost') }), 'createPost');
    },
    /** `status|storage_key|last_error` of a photo row and its job. */
    mediaState(mediaId) {
      const [status = '', key = '', error = ''] = query(
        "select m.processing_status || '|' || m.storage_key || '|' || coalesce(q.last_error, '') from public.post_media m " +
          "left join kc_private.post_media_processing q on q.media_id = m.id where m.id = :'mid';",
        { mid: id(mediaId, 'mediaState') }).split('|');
      return { status, key, error };
    },
    deletePost(postId) {
      query("delete from public.posts where id = :'pid';", { pid: id(postId, 'deletePost') });
    },
  };
}

/** The member-side calls of this proof, on top of the shared API port. */
export function createPhotoApi(base, { supabaseUrl, anonKey, fetch = globalThis.fetch }) {
  const asMember = async (step, path, token, { method = 'POST', body, contentType = 'application/json', prefer } = {}) => {
    const res = await fetch(`${supabaseUrl}${path}`, {
      method,
      headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': contentType, ...(prefer ? { Prefer: prefer } : {}) },
      body: Buffer.isBuffer(body) ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`${step}: HTTP ${res.status}`);
    return res.headers.get('content-type')?.includes('json') ? res.json() : null;
  };
  return {
    ...base,
    uploadAs: (token, key, bytes) =>
      asMember('upload photo', `/storage/v1/object/${BUCKET}/${key}`, token, { body: bytes, contentType: 'image/jpeg' }),
    recordPhoto: async (token, row) =>
      (await asMember('record photo', '/rest/v1/post_media', token, { body: row, prefer: 'return=representation' }))[0].id,
    postDetail: (token, postId) => asMember('post_detail', '/rest/v1/rpc/post_detail', token, { body: { p_post_id: postId } }),
    /** Public bytes of an object, or null when it does not exist. */
    publicObject: async (key) => {
      const res = await fetch(`${supabaseUrl}/storage/v1/object/public/${BUCKET}/${key}`, { signal: AbortSignal.timeout(60_000) });
      return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    },
  };
}

/** Polls the photo row until the pipeline settled it; `ready` or `failed`, or the last state seen. */
async function waitForPipeline(sql, mediaId, sleep, tries = 36) {
  let state = sql.mediaState(mediaId);
  for (let i = 0; state.status === 'pending' && i < tries; i += 1) {
    await sleep(5000);
    state = sql.mediaState(mediaId);
  }
  return state;
}

/** Runs the proof; resolves to what it measured, rejects with the first thing that was wrong. */
export async function runProof({
  api,
  sql,
  log = console.log,
  stamp = Date.now(),
  password = randomBytes(24).toString('base64url'),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
}) {
  const memberIds = [];
  const accounts = {};
  const files = [];
  let postId = null;
  try {
    for (const role of ['owner', 'viewer']) {
      const email = `post-media-proof-${stamp}-${role}@seed.kc.test`;
      const memberId = await api.createMember(email, password);
      if (!UUID.test(String(memberId))) throw new Error(`create ${role}: no user id in the answer`);
      memberIds.push(memberId);
      sql.activate(memberId);
      accounts[role] = { id: memberId, token: await api.signIn(email, password) };
    }
    const { owner, viewer } = accounts;
    postId = sql.createPost(owner.id);

    const key = `${owner.id}/${randomUUID()}/0.jpg`;
    const photo = jpegWithGps();
    for (const objectKey of [key, thumbOf(key)]) {
      await api.uploadAs(owner.token, objectKey, photo);
      files.push(objectKey);
    }
    const started = now();
    const mediaId = await api.recordPhoto(owner.token, {
      post_id: postId, owner_id: owner.id, storage_key: key, ordinal: 0, mime_type: 'image/jpeg', size_bytes: photo.length,
    });

    const state = await waitForPipeline(sql, mediaId, sleep);
    const seconds = Math.round((now() - started) / 1000);
    if (state.key.startsWith('derived/')) files.push(state.key, thumbOf(state.key));
    if (state.status !== 'ready') throw new Error(`the photo is ${state.status || 'gone'} after ${seconds} s (${state.error || 'no error recorded'})`);
    log(`the photo became ready ${seconds} s after it was recorded`);

    const detail = await api.postDetail(viewer.token, postId);
    const media = detail?.media ?? [];
    if (media.length !== 1) throw new Error(`the viewer sees ${media.length} photos instead of 1`);
    if (!media[0].storage_key.startsWith(`derived/${owner.id}/`)) throw new Error('the viewer is not served the sanitized copy');
    assertClean('the copy', await api.publicObject(media[0].storage_key));
    assertClean('the thumb', await api.publicObject(thumbOf(media[0].storage_key)));
    return { seconds };
  } finally {
    if (postId) await Promise.resolve().then(() => sql.deletePost(postId)).catch(() => undefined);
    if (files.length > 0) await Promise.resolve(api.remove(BUCKET, files)).catch(() => undefined);
    for (const memberId of memberIds) await Promise.resolve(api.deleteMember(memberId)).catch(() => undefined);
  }
}

async function main(env) {
  const supabaseUrl = (env.SUPABASE_URL ?? '').replace(/\/$/, '');
  const dbUrl = env.PROOF_DB_URL ?? '';
  for (const name of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'PROOF_DB_URL']) {
    if (!env[name]) throw new Error(`${name} is not set`);
  }
  assertDevProject(supabaseUrl, dbUrl);
  const base = createApi({ supabaseUrl, anonKey: env.SUPABASE_ANON_KEY, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY });
  const api = createPhotoApi(base, { supabaseUrl, anonKey: env.SUPABASE_ANON_KEY });
  const { seconds } = await runProof({ api, sql: createPhotoSql(createPsql({ dbUrl })) });
  console.log(`post photo proof passed: ready in ${seconds} s, the viewer gets a copy without the GPS block`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.env).catch((error) => {
    console.error(`::error::post photo proof failed: ${error.message}`);
    process.exit(1);
  });
}
