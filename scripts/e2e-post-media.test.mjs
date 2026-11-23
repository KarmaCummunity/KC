// Self-test of the kc-dev post photo proof (scripts/e2e-post-media.mjs) against fakes: the proof
// passes only when the viewer is served a clean copy, fails on any leak or stuck photo, and always
// removes what it created.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertClean, createPhotoSql, GPS_MARKER, jpegWithGps, runProof, thumbOf } from './e2e-post-media.mjs';

const OWNER = '0a0a0a0a-0000-4000-8000-00000000000a';
const VIEWER = '0b0b0b0b-0000-4000-8000-00000000000b';
const POST = '40000000-0000-4000-8000-000000000001';
const MEDIA = '50000000-0000-4000-8000-000000000001';
const COPY = `derived/${OWNER}/${MEDIA}-a1.jpg`;
/** The fixture without its APP1 block: what the worker's copy looks like. */
const CLEAN = (() => {
  const dirty = jpegWithGps();
  const length = (dirty[4] << 8) | dirty[5];
  return Buffer.concat([dirty.subarray(0, 2), dirty.subarray(4 + length)]);
})();

/** Fakes of both ports; `states` are the photo states the database reports, in order. */
function fakes({ states = [{ status: 'pending', key: '', error: '' }, { status: 'ready', key: COPY, error: '' }], copy = CLEAN, media } = {}) {
  const seen = { deletedPosts: [], removed: [], deletedMembers: [], uploads: [], activated: [] };
  const members = [OWNER, VIEWER];
  const api = {
    createMember: async () => members.shift(),
    signIn: async (email) => `token:${email}`,
    deleteMember: async (id) => seen.deletedMembers.push(id),
    remove: async (_bucket, paths) => seen.removed.push(...paths),
    uploadAs: async (_token, key) => seen.uploads.push(key),
    recordPhoto: async () => MEDIA,
    postDetail: async () => ({ media: media ?? [{ storage_key: COPY }] }),
    publicObject: async () => copy,
  };
  const sql = {
    activate: (id) => seen.activated.push(id),
    createPost: () => POST,
    mediaState: () => (states.length > 1 ? states.shift() : states[0]),
    deletePost: (id) => seen.deletedPosts.push(id),
  };
  return { api, sql, seen };
}

const quiet = { log: () => undefined, sleep: async () => undefined, stamp: 1 };

test('passes when the viewer is served a copy without the GPS block, and removes everything it made', async () => {
  const { api, sql, seen } = fakes();
  const result = await runProof({ api, sql, ...quiet });
  assert.equal(typeof result.seconds, 'number');
  assert.deepEqual(seen.activated, [OWNER, VIEWER]);
  assert.equal(seen.uploads.length, 2);
  assert.equal(seen.uploads[1], thumbOf(seen.uploads[0]));
  assert.deepEqual(seen.deletedPosts, [POST]);
  assert.deepEqual(seen.removed, [...seen.uploads, COPY, thumbOf(COPY)]);
  assert.deepEqual(seen.deletedMembers, [OWNER, VIEWER]);
});

test('fails when the served copy still carries the GPS block, and still cleans up', async () => {
  const { api, sql, seen } = fakes({ copy: jpegWithGps() });
  await assert.rejects(runProof({ api, sql, ...quiet }), /the GPS block reached other members/);
  assert.deepEqual(seen.deletedPosts, [POST]);
  assert.deepEqual(seen.deletedMembers, [OWNER, VIEWER]);
});

test('fails when the viewer is served the original instead of the copy', async () => {
  const { api, sql } = fakes({ media: [{ storage_key: `${OWNER}/batch/0.jpg` }] });
  await assert.rejects(runProof({ api, sql, ...quiet }), /not served the sanitized copy/);
});

test('fails with the recorded error when the photo ends failed or never leaves pending', async () => {
  const failed = fakes({ states: [{ status: 'failed', key: `${OWNER}/b/0.jpg`, error: 'not_an_image' }] });
  await assert.rejects(runProof({ api: failed.api, sql: failed.sql, ...quiet }), /failed after \d+ s \(not_an_image\)/);
  const stuck = fakes({ states: [{ status: 'pending', key: `${OWNER}/b/0.jpg`, error: '' }] });
  await assert.rejects(runProof({ api: stuck.api, sql: stuck.sql, ...quiet }), /pending after/);
  assert.deepEqual(stuck.seen.deletedMembers, [OWNER, VIEWER]);
});

test('the fixture is a whole JPEG carrying the marker; assertClean refuses it and accepts the copy', () => {
  const photo = jpegWithGps();
  assert.deepEqual([photo[0], photo[1], photo.at(-2), photo.at(-1)], [0xff, 0xd8, 0xff, 0xd9]);
  assert.ok(photo.includes(Buffer.from(GPS_MARKER, 'latin1')));
  assert.throws(() => assertClean('x', photo), /GPS block/);
  assert.throws(() => assertClean('x', null), /not a JPEG/);
  assertClean('copy', CLEAN);
  assert.equal(thumbOf('a/b/0.jpg'), 'a/b/0-thumb.jpg');
});

test('the database helpers pass ids as psql variables and refuse anything that is not an id', () => {
  const calls = [];
  const sql = createPhotoSql((text, vars) => {
    calls.push({ text, vars });
    return text.startsWith('update') ? '1' : POST;
  });
  sql.activate(OWNER);
  assert.equal(sql.createPost(OWNER), POST);
  assert.ok(calls.every((c) => !c.text.includes(OWNER)), 'an id never enters the SQL text');
  assert.throws(() => sql.activate("x'; drop table public.posts; --"), /not an id/);
  assert.throws(() => sql.deletePost('1 or 1=1'), /not an id/);
});
