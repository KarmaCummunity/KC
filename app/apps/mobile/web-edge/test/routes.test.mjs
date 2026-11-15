// The route files are what Cloudflare loads: check they export the GET handler and pass the path
// parameter, the environment and `next` through to the shared handler.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const WHATSAPP = 'WhatsApp/2.0';
const context = (url, params) => ({
  request: new Request(url, { headers: { 'user-agent': WHATSAPP } }),
  env: {},
  params,
  next: async () => new Response('SPA'),
});

describe('functions routes', () => {
  it('/post/[id] answers a crawler with a card for that id', async () => {
    const { onRequestGet } = await import('../../functions/post/[id].js');
    const res = await onRequestGet(context('https://karma-community-kc.com/post/abc', { id: 'abc' }));
    assert.match(await res.text(), /og:url" content="https:\/\/karma-community-kc\.com\/post\/abc"/);
  });
  it('/user/[handle] answers a crawler with the profile card for that handle', async () => {
    const { onRequestGet } = await import('../../functions/user/[handle].js');
    const res = await onRequestGet(context('https://karma-community-kc.com/user/dana.k', { handle: 'dana.k' }));
    assert.match(await res.text(), /og:url" content="https:\/\/karma-community-kc\.com\/user\/dana\.k"/);
  });
});
