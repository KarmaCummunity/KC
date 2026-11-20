import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleSharedLink } from '../src/handleSharedLink.mjs';

const POST_ID = 'a3ee6f9d-7d18-40f8-9f6a-12d51bd3f042';
const env = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'anon', KC_ANDROID_STORE_URL: 'https://play.google.com/store/apps/details?id=x' };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) Chrome/124 Mobile Safari/537.36';
const next = async () => new Response('<html>SPA</html>', { status: 200, headers: { 'content-type': 'text/html' } });
const req = (path, ua) => new Request(`https://karma-community-kc.com${path}`, { headers: { 'user-agent': ua } });
const rows = (list) => async () => new Response(JSON.stringify(list), { status: 200 });

describe('handleSharedLink /post', () => {
  it('serves a crawler the card of a ride as a ride', async () => {
    let call = null;
    const fetchImpl = async (url, init) => {
      call = { url, init };
      return new Response(JSON.stringify([{ title: 'נוסע/ת מירושלים להוד השרון', description: null, direction: 'offer', status: 'open', world_slug: 'rides', city_name_he: 'ירושלים', cover_bucket: null, cover_key: null }]));
    };
    const res = await handleSharedLink({ kind: 'post', param: POST_ID, request: req(`/post/${POST_ID}`, 'WhatsApp/2.0'), env, next, fetchImpl });
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.equal(res.headers.get('vary'), 'User-Agent');
    assert.ok(html.includes('נוסע/ת מירושלים להוד השרון'));
    assert.ok(!html.includes('חפץ שמחכה לבית חדש'));
    assert.ok(html.includes(`og:url" content="https://karma-community-kc.com/post/${POST_ID}"`));
    assert.equal(call.url, 'https://proj.supabase.co/rest/v1/rpc/post_share_card');
    assert.equal(call.init.method, 'POST');
    assert.deepEqual(JSON.parse(call.init.body), { p_post_id: POST_ID });
  });
  it('previews the light 400 px thumb, typed and sized, when the cover photo itself is too heavy', async () => {
    const sof = (w, h) => [0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
    const sos = [0xff, 0xda, 0x00, 0x0c, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0];
    const jpeg = (w, h) => new Uint8Array([0xff, 0xd8, ...sof(w, h), ...sos, 1, 2, 3, 0xff, 0xd9]);
    const fetchImpl = async (url) => {
      if (url.endsWith('/rpc/post_share_card')) {
        return new Response(JSON.stringify([{ title: 'Sofa', description: null, direction: 'offer', status: 'open', world_slug: 'items', city_name_he: null, cover_bucket: 'post-images', cover_key: 'u/b/0.jpg' }]));
      }
      // The 2048 px photo declares 540 KB (over the cap, never read); the thumb is complete and clean.
      if (!url.endsWith('0-thumb.jpg')) return new Response(new Uint8Array(4), { status: 200, headers: { 'content-length': '540000' } });
      const body = jpeg(400, 300);
      return new Response(body, { status: 200, headers: { 'content-length': String(body.length) } });
    };
    const res = await handleSharedLink({ kind: 'post', param: POST_ID, request: req(`/post/${POST_ID}`, 'WhatsApp/2.0'), env, next, fetchImpl });
    const html = await res.text();
    assert.ok(html.includes('og:image" content="https://proj.supabase.co/storage/v1/object/public/post-images/u/b/0-thumb.jpg"'));
    assert.ok(html.includes('og:image:type" content="image/jpeg"'));
    assert.ok(html.includes('og:image:width" content="400"') && html.includes('og:image:height" content="300"'));
  });
  it('serves the generic card when the post is unreadable, malformed or the backend fails', async () => {
    for (const [param, fetchImpl] of [[POST_ID, rows([])], ['not-a-uuid', rows([{ title: 'x' }])], [POST_ID, async () => { throw new Error('boom'); }], [POST_ID, async () => new Response('{}', { status: 500 })]]) {
      const res = await handleSharedLink({ kind: 'post', param, request: req(`/post/${param}`, 'WhatsApp/2.0'), env, next, fetchImpl });
      const html = await res.text();
      assert.ok(html.includes('og:title" content="KC'), `generic card for ${param}`);
    }
  });
  it('redirects a phone to its store when configured and passes everyone else to the SPA', async () => {
    const android = await handleSharedLink({ kind: 'post', param: POST_ID, request: req(`/post/${POST_ID}`, ANDROID), env, next });
    assert.equal(android.status, 302);
    assert.equal(android.headers.get('location'), env.KC_ANDROID_STORE_URL);
    assert.equal(android.headers.get('cache-control'), 'no-store');
    const iphone = await handleSharedLink({ kind: 'post', param: POST_ID, request: req(`/post/${POST_ID}`, IPHONE), env, next });
    assert.equal(await iphone.text(), '<html>SPA</html>');
    assert.match(iphone.headers.get('vary'), /User-Agent/);
    const forced = await handleSharedLink({ kind: 'post', param: POST_ID, request: req(`/post/${POST_ID}?web=1`, ANDROID), env, next });
    assert.equal(forced.status, 200);
  });
  it('ignores a store URL that is not https', async () => {
    const res = await handleSharedLink({ kind: 'post', param: POST_ID, request: req(`/post/${POST_ID}`, ANDROID), env: { ...env, KC_ANDROID_STORE_URL: 'javascript:alert(1)' }, next });
    assert.equal(res.status, 200);
  });
});

describe('handleSharedLink /user', () => {
  it('serves a generic profile card without reading any data', async () => {
    let called = false;
    const res = await handleSharedLink({ kind: 'user', param: 'dana.k', request: req('/user/dana.k', 'TelegramBot'), env, next, fetchImpl: async () => { called = true; return new Response('[]'); } });
    assert.equal(called, false);
    assert.ok((await res.text()).includes('og:title'));
  });
  it('falls back to the brand card for a malformed handle', async () => {
    const res = await handleSharedLink({ kind: 'user', param: '<script>', request: req('/user/x', 'WhatsApp/2.0'), env, next });
    assert.ok((await res.text()).includes('og:title" content="KC'));
  });
});
