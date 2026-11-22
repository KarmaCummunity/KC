// SEC-1064 (KC#1661) — chat images are private, checked on the deployed kc-dev project.
//
// A chat image lives in the private `chat-media` bucket under `<sender id>/<chat id>/<file>`.
// Whoever can read that chat can read the image, through a short-lived signed URL; nobody else
// can, even with the exact path (storage policy `chat_media_select_chat_member`). The pgTAP suite
// `supabase/tests/095_platform.sql` proves the policy on a scratch database. This journey proves it
// on the deployed one, over the Storage API the app uses: member A puts an image in the chat with
// member B, B opens it the way the app does, and a member outside the chat, a signed-out visitor
// and the public URL are refused.
//
// No browser. The policy reads the chat from the object's path, so the journey needs no message
// row; the image is uploaded by the run and removed after it.
import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { rest, sessionFor } from '../lib/api';
import { SUPABASE_URL, USER_A, USER_B, USER_C, anonKey } from '../lib/env';

const BUCKET = 'chat-media';
/** Tries per call. Only a call without an answer is repeated: kc-dev stalls at times (#2368). */
const ATTEMPTS = 3;

/** Who makes a Storage call: a member's access token, the public key, or nobody (`null`). */
type Caller = string | null;

/**
 * One Storage call as `caller`. A 5xx or a timeout is not an answer and is tried again; anything
 * below 500 is final, so an image that was served to the wrong caller fails its step at once.
 */
async function storage(
  method: 'GET' | 'POST' | 'DELETE',
  route: string,
  caller: Caller,
  init: { body?: Buffer | string; contentType?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = caller ? { apikey: await anonKey(), Authorization: `Bearer ${caller}` } : {};
  if (init.contentType) headers['Content-Type'] = init.contentType;
  let failure: unknown = new Error(`no answer from Storage for ${method} ${route}`);
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${SUPABASE_URL}/storage/v1/${route}`, {
        method,
        headers,
        body: init.body,
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status < 500) return response;
      failure = new Error(`Storage answered ${response.status} for ${method} ${route}`);
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}

/** Downloads the image as `caller`, the way a signed-in app would without a signed URL. */
const download = (path: string, caller: Caller) => storage('GET', `object/authenticated/${BUCKET}/${path}`, caller);

/** Asks Storage for a signed URL of the image as `caller` (what `chatMediaUrl.ts` does). */
const sign = (path: string, caller: Caller) =>
  storage('POST', `object/sign/${BUCKET}/${path}`, caller, { body: JSON.stringify({ expiresIn: 60 }), contentType: 'application/json' });

/** A refusal: the caller was answered and got nothing. Storage answers a 4xx, whatever the reason. */
function expectRefused(response: Response, what: string): void {
  expect(response.status, what).toBeGreaterThanOrEqual(400);
  expect(response.status, what).toBeLessThan(500);
}

test.describe.serial('chat images are private', () => {
  let image: Buffer;
  /** `<A's id>/<chat id>/<file>`: the path the app would store in the message. */
  let path = '';
  let tokenA = '';
  let tokenB = '';

  test('member A puts an image in the chat with B, and B opens it through a signed URL', async () => {
    test.setTimeout(180_000);
    const a = await sessionFor(USER_A);
    const b = await sessionFor(USER_B);
    tokenA = a.session.access_token as string;
    tokenB = b.session.access_token as string;
    const aId = (a.session.user as { id: string }).id;
    const bId = (b.session.user as { id: string }).id;

    // The pair's one direct chat; opening it again changes nothing.
    const chat = await rest<{ id: string }>(tokenA, 'rpc/open_direct_chat', { method: 'POST', body: { p_user_id: bId } });
    image = await readFile(new URL('../fixtures/item.png', import.meta.url));
    const candidate = `${aId}/${chat.id}/e2e-${Date.now()}.png`;
    const uploaded = await storage('POST', `object/${BUCKET}/${candidate}`, tokenA, { body: image, contentType: 'image/png' });
    expect(uploaded.status, `upload: ${await uploaded.text()}`).toBe(200);
    path = candidate;

    // B, the other member of the chat, gets a signed URL, and the URL alone serves the image.
    const signed = await sign(path, tokenB);
    expect(signed.status, 'the other member of the chat gets a signed URL').toBe(200);
    const { signedURL } = (await signed.json()) as { signedURL: string };
    const served = await fetch(`${SUPABASE_URL}/storage/v1${signedURL}`, { signal: AbortSignal.timeout(30_000) });
    expect(served.status, 'the signed URL serves the image').toBe(200);
    expect(Buffer.from(await served.arrayBuffer()).equals(image), 'the signed URL serves the uploaded bytes').toBe(true);
  });

  test('a member outside the chat cannot read or sign the image, even with its exact path', async () => {
    expect(path, 'image from the upload step').not.toBe('');
    const c = await sessionFor(USER_C);
    const tokenC = c.session.access_token as string;
    expectRefused(await download(path, tokenC), 'download by a member outside the chat');
    expectRefused(await sign(path, tokenC), 'signed URL for a member outside the chat');
    // The same download as a member of the chat succeeds, so the refusals above are about who asks.
    expect((await download(path, tokenB)).status, 'download by a member of the chat').toBe(200);
  });

  test('a signed-out visitor cannot read the image: not with the public key, not through the public URL', async () => {
    expect(path, 'image from the upload step').not.toBe('');
    const key = await anonKey();
    expectRefused(await download(path, key), 'download with the public key');
    expectRefused(await sign(path, key), 'signed URL with the public key');
    expectRefused(await download(path, null), 'download without credentials');
    expectRefused(await storage('GET', `object/public/${BUCKET}/${path}`, null), 'the public URL of a private bucket');
  });

  test.afterAll(async () => {
    // Best effort: the sender may remove their own files; a leftover is a few bytes on kc-dev.
    if (path) await storage('DELETE', `object/${BUCKET}/${path}`, tokenA).catch(() => undefined);
  });
});
