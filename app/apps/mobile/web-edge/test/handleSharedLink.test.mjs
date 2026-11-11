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
    let requested = '';
    const fetchImpl = async (url) => {
      requested = url;
      return new Response(JSON.stringify([{ title: 'נוסע/ת מירושלים להוד השרון', description: null, type: 'Give', status: 'open', world_slug: 'rides', city: 'ירושלים', media_assets: [] }]));
    };
    const res = await handleSharedLink({ kind: 'post', param: POST_ID, request: req(`/post/${POST_ID}`, 'WhatsApp/2.0'), env, next, fetchImpl });
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.equal(res.headers.get('vary'), 'User-Agent');
    assert.ok(html.includes('נוסע/ת מירושלים להוד השרון'));
    assert.ok(!html.includes('חפץ שמחכה לבית חדש'));
    assert.ok(html.includes(`og:url" content="https://karma-community-kc.com/post/${POST_ID}"`));
    assert.ok(requested.includes('visibility=eq.Public') && requested.includes('status=in.(open,closed_delivered)'));
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
