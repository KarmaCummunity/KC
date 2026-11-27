// A photo a linked Pro member sends in WhatsApp completes their waiting bot draft (D158 as
// approved). Ported from supabase/functions/_shared/whatsapp/photo.ts. The database decides which draft (api_bot_pending_photo_draft); with none waiting
// the photo is neither downloaded nor stored. Otherwise: download and check it (media.ts),
// upload it to `post-images` under the owner's folder, register it and publish through the
// bot gates (api_bot_attach_post_photo), and tell the member what happened, in he/en.

import { randomUUID } from 'node:crypto';
import type { FetchFn } from '../metaClient';
import { postEditLink } from './appLink';
import type { RpcFn } from './inboundMessages';
import { type DownloadResult, downloadPhoto, type GraphConfig, photoType } from './media';
import { photoReply, type PhotoStatus } from './photoReplies';
import type { Lang } from './replies';

export type { PhotoStatus } from './photoReplies';

export const POST_PHOTO_BUCKET = 'post-images';

export type PhotoStorage = {
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<{ error: { message: string } | null }>;
  remove(path: string): Promise<void>;
};

export type PhotoDeps = {
  rpc: RpcFn;
  fetch: FetchFn;
  graph: GraphConfig;
  storage: PhotoStorage;
  appBaseUrl?: string;
  newId?: () => string;
};

export type PhotoInput = { waId: string; userId: string; mediaId: string; mimeType: string | null; lang: Lang };
export type PhotoResult = { status: PhotoStatus; postId?: string; detail?: string };

type PendingDraft = { session_id: string; post_id: string; world_slug: string };
type Attached = { post_id: string; status: 'open' | 'draft'; review: boolean };

async function call(deps: PhotoDeps, fn: string, args: Record<string, unknown>) {
  const { data, error } = await deps.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

async function reply(deps: PhotoDeps, input: PhotoInput, status: PhotoStatus, draft?: PendingDraft) {
  const link = draft ? postEditLink(draft.post_id, draft.world_slug, deps.appBaseUrl) : '';
  await call(deps, 'api_whatsapp_queue_reply', {
    p_wa_id: input.waId,
    p_body: photoReply(status, input.lang, link),
    p_reply_kind: 'reply',
  });
  return { status, postId: draft?.post_id };
}

/** Uploads and attaches the photo; a refused attach removes the uploaded file again. */
async function attach(deps: PhotoDeps, input: PhotoInput, draft: PendingDraft, photo: DownloadResult) {
  if (!photo.ok) return { status: photo.reason === 'invalid_photo' ? 'invalid_photo' : 'failed', detail: photo.detail } as const;
  const id = deps.newId?.() ?? randomUUID();
  const path = `${input.userId}/${id}/0.${photo.photo.ext}`;
  const up = await deps.storage.upload(path, photo.photo.bytes, photo.photo.mimeType);
  if (up.error) return { status: 'failed', detail: `upload: ${up.error.message}` } as const;
  const { data, error } = await deps.rpc('api_bot_attach_post_photo', {
    p_wa_id: input.waId,
    p_owner_id: input.userId,
    p_session_id: draft.session_id,
    p_storage_path: path,
    p_mime_type: photo.photo.mimeType,
    p_size_bytes: photo.photo.bytes.length,
  });
  if (error) {
    await deps.storage.remove(path).catch(() => undefined);
    return { status: 'failed', detail: `attach: ${error.message}` } as const;
  }
  const r = data as Attached;
  return { status: r.status === 'open' ? 'published' : 'draft_staff_review' } as const;
}

export async function handleProPhoto(deps: PhotoDeps, input: PhotoInput): Promise<PhotoResult> {
  const draft = (await call(deps, 'api_bot_pending_photo_draft', {
    p_wa_id: input.waId,
    p_owner_id: input.userId,
  })) as PendingDraft | null;
  if (!draft?.session_id) return await reply(deps, input, 'no_draft');
  // A type the webhook already names as wrong is refused before any download.
  const photo: DownloadResult = input.mimeType && !photoType(input.mimeType)
    ? { ok: false, reason: 'invalid_photo', detail: 'type' }
    : await downloadPhoto(deps.graph, input.mediaId, deps.fetch);
  const out = await attach(deps, input, draft, photo);
  const result = await reply(deps, input, out.status, draft);
  return 'detail' in out ? { ...result, detail: out.detail } : result;
}
