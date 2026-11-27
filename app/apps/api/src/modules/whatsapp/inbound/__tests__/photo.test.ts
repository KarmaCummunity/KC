import { describe, expect, it } from 'vitest';
import { postEditLink } from '../appLink';
import type { RpcFn } from '../inboundMessages';
import { PHOTO_MAX_BYTES, photoType, sniffPhotoType } from '../media';
import { handleProPhoto, type PhotoDeps, type PhotoInput } from '../photo';
import { PHOTO_REPLY_TEXT } from '../photoReplies';

type Call = { fn: string; args: Record<string, unknown> };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]);
const DRAFT = { session_id: 's1', post_id: 'p1', world_slug: 'items', direction: 'offer', photos: 0 };
const INPUT: PhotoInput = { waId: '972500000001', userId: 'u-pro', mediaId: 'media-1', mimeType: 'image/jpeg', lang: 'he' };

type Setup = {
  draft?: unknown;
  attach?: { data?: unknown; error?: string };
  meta?: Record<string, unknown> | null;
  bytes?: Uint8Array;
  uploadError?: string;
};

function world(setup: Setup = {}) {
  const calls: Call[] = [];
  const fetched: string[] = [];
  const uploads: string[] = [];
  const removed: string[] = [];
  const rpc: RpcFn = (fn, args) => {
    calls.push({ fn, args });
    if (fn === 'api_bot_pending_photo_draft') return Promise.resolve({ data: setup.draft === undefined ? DRAFT : setup.draft, error: null });
    if (fn === 'api_bot_attach_post_photo') {
      const a = setup.attach ?? { data: { post_id: 'p1', status: 'open', review: false } };
      return Promise.resolve({ data: a.data ?? null, error: a.error ? { message: a.error } : null });
    }
    return Promise.resolve({ data: 'out-1', error: null });
  };
  const fetchFn = (url: string, init?: RequestInit) => {
    fetched.push(url);
    expect((init?.headers as Record<string, string>).Authorization).toEqual('Bearer graph-token');
    if (url.includes('/media-1')) {
      const meta = setup.meta === undefined ? { url: 'https://lookaside.test/file', mime_type: 'image/jpeg', file_size: 8 } : setup.meta;
      return Promise.resolve(new Response(JSON.stringify(meta), { status: meta ? 200 : 404 }));
    }
    return Promise.resolve(new Response(new Blob([(setup.bytes ?? JPEG).slice()]), { status: 200 }));
  };
  const deps: PhotoDeps = {
    rpc,
    fetch: fetchFn,
    graph: { token: 'graph-token', graphVersion: 'v21.0', baseUrl: 'https://graph.test' },
    storage: {
      upload: (path) => {
        uploads.push(path);
        return Promise.resolve({ error: setup.uploadError ? { message: setup.uploadError } : null });
      },
      remove: (path) => {
        removed.push(path);
        return Promise.resolve();
      },
    },
    appBaseUrl: 'https://kc.test/',
    newId: () => 'batch-1',
  };
  const reply = () => String(calls.find((c) => c.fn === 'api_whatsapp_queue_reply')?.args.p_body ?? '');
  return { deps, calls, fetched, uploads, removed, reply };
}

describe('WhatsApp photo flow', () => {
  it('no draft waiting: a polite reply, nothing downloaded or stored', async () => {
    const w = world({ draft: null });
    expect((await handleProPhoto(w.deps, INPUT)).status).toEqual('no_draft');
    expect(w.fetched).toEqual([]);
    expect(w.uploads).toEqual([]);
    expect(w.reply()).toEqual(PHOTO_REPLY_TEXT.no_draft.he);
    expect(w.calls[0]).toEqual({ fn: 'api_bot_pending_photo_draft', args: { p_wa_id: INPUT.waId, p_owner_id: 'u-pro' } });
  });

  it('a photo publishes the draft: uploaded under the owner, attached for the linked member', async () => {
    const w = world();
    const r = await handleProPhoto(w.deps, { ...INPUT, lang: 'en' });
    expect(r).toEqual({ status: 'published', postId: 'p1' });
    expect(w.fetched).toEqual(['https://graph.test/v21.0/media-1', 'https://lookaside.test/file']);
    expect(w.uploads).toEqual(['u-pro/batch-1/0.jpg']);
    const attach = w.calls.find((c) => c.fn === 'api_bot_attach_post_photo')!;
    expect(attach.args).toEqual({
      p_wa_id: INPUT.waId, p_owner_id: 'u-pro', p_session_id: 's1', p_storage_path: 'u-pro/batch-1/0.jpg',
      p_mime_type: 'image/jpeg', p_size_bytes: JPEG.length,
    });
    expect(w.reply()).toEqual(PHOTO_REPLY_TEXT.published.en);
  });

  it('low confidence: the photo is kept and the post stays in staff review', async () => {
    const w = world({ attach: { data: { post_id: 'p1', status: 'draft', review: true } }, bytes: PNG,
      meta: { url: 'https://lookaside.test/file', mime_type: 'image/png' } });
    expect((await handleProPhoto(w.deps, { ...INPUT, mimeType: 'image/png' })).status).toEqual('draft_staff_review');
    expect(w.uploads).toEqual(['u-pro/batch-1/0.png']);
    expect(w.reply()).toEqual(PHOTO_REPLY_TEXT.draft_staff_review.he);
  });

  it('a wrong type is refused before any download, with the app link', async () => {
    const w = world();
    expect((await handleProPhoto(w.deps, { ...INPUT, mimeType: 'image/webp' })).status).toEqual('invalid_photo');
    expect(w.fetched).toEqual([]);
    expect(w.reply()).toEqual(PHOTO_REPLY_TEXT.invalid_photo.he.replace('{link}', 'https://kc.test/edit-post/p1'));
  });

  it('the bytes decide the type, and the size limit holds', async () => {
    const fake = world({ bytes: new TextEncoder().encode('<html>not a photo</html>') });
    expect((await handleProPhoto(fake.deps, INPUT)).status).toEqual('invalid_photo');
    expect(fake.uploads).toEqual([]);
    const big = world({ meta: { url: 'https://lookaside.test/file', mime_type: 'image/jpeg', file_size: PHOTO_MAX_BYTES + 1 } });
    expect((await handleProPhoto(big.deps, INPUT)).status).toEqual('invalid_photo');
    expect(big.fetched.length).toEqual(1);
  });

  it('a refused attach removes the uploaded file and offers the app', async () => {
    const w = world({ attach: { error: 'owner_mismatch' } });
    const r = await handleProPhoto(w.deps, INPUT);
    expect(r.status).toEqual('failed');
    expect(w.removed).toEqual(['u-pro/batch-1/0.jpg']);
    expect(w.reply()).toEqual(PHOTO_REPLY_TEXT.failed.he.replace('{link}', 'https://kc.test/edit-post/p1'));
  });

  it('a Graph lookup failure or an upload failure is reported, nothing attached', async () => {
    const lookup = world({ meta: null });
    expect((await handleProPhoto(lookup.deps, INPUT)).status).toEqual('failed');
    const upload = world({ uploadError: 'bucket down' });
    expect((await handleProPhoto(upload.deps, INPUT)).status).toEqual('failed');
    for (const w of [lookup, upload]) expect(w.calls.some((c) => c.fn === 'api_bot_attach_post_photo')).toEqual(false);
  });

  it('media helpers and the app link', () => {
    expect(photoType('image/JPEG; charset=x')).toEqual('image/jpeg');
    expect(photoType('image/gif')).toEqual(null);
    expect(sniffPhotoType(PNG)).toEqual('image/png');
    expect(sniffPhotoType(new Uint8Array([1, 2, 3]))).toEqual(null);
    expect(postEditLink('p1', 'items')).toEqual('https://karma-community-kc.com/edit-post/p1');
    expect(postEditLink('p2', 'food', 'https://dev.example//')).toEqual('https://dev.example/edit-listing/p2');
  });
});
