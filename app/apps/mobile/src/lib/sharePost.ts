// FR-POST-023 — share a link (a post or a profile) via the OS share sheet. Returns a discriminated
// union outcome; never throws. The share URL appears in the message body
// exactly once on every platform (the prior version's duplicated-link bug
// in WhatsApp came from RN's Android Share concatenating the `url` field
// onto EXTRA_TEXT after `message`).
//
//   iOS w/ image:  Share.share({ message: <text+url>, url: <fileUri>, title })
//   iOS no image:  Share.share({ message: <text+url>, title })
//   Android (any): Share.share({ message: <text+url>, title })            -- no url
//   Web w/ files:  navigator.share({ title, text, url, files: [imageFile] })
//   Web no files:  navigator.share({ title, text, url })
//   Web no share:  navigator.clipboard.writeText(url) → outcome 'copied'.

import { Platform, Share } from 'react-native';

import { buildPostShareUrl } from './buildPostShareUrl';
import { downloadPostImageForShare } from './downloadPostImageForShare';

export type ShareLinkInput = Readonly<{
  /** The canonical link; it appears in the shared text exactly once. */
  url: string;
  title: string;
  message: string;
  /** Names the cached image file, so concurrent shares never overwrite each other. */
  imageKey: string;
  /** Public URL of the image to attach (a post's first photo). Omitted when there is none. */
  remoteImageUrl?: string;
}>;

export type PostShareInput = Readonly<{
  postId: string;
  title: string;
  message: string;
  webBaseUrl: string;
  /** Public URL of `mediaAssets[0]` when present. Omitted on no-media posts. */
  remoteImageUrl?: string;
}>;

export type SharePostOutcome =
  | { kind: 'shared' }
  | { kind: 'dismissed' }
  | { kind: 'copied' }
  | { kind: 'failed'; reason: string };

type WebShareNavigator = {
  share?: (data: { title?: string; text?: string; url?: string; files?: File[] }) => Promise<void>;
  canShare?: (data: { files?: File[] }) => boolean;
  clipboard?: { writeText: (text: string) => Promise<void> };
};

async function fetchAsFile(remoteUrl: string, imageKey: string): Promise<File | null> {
  if (typeof fetch === 'undefined' || typeof File === 'undefined') return null;
  try {
    const resp = await fetch(remoteUrl);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const ext = (blob.type.split('/')[1] ?? 'jpg').replace('jpeg', 'jpg');
    const safeId = imageKey.replace(/[^a-zA-Z0-9-_]/g, '_');
    return new File([blob], `kc-share-${safeId}.${ext}`, { type: blob.type || 'image/jpeg' });
  } catch (err) {
    // Image attach is best-effort; the share still goes out as text-only.
    console.warn('[sharePost] fetchAsFile failed', err instanceof Error ? err.message : err);
    return null;
  }
}

async function shareWeb(
  input: ShareLinkInput,
  url: string,
  nav: WebShareNavigator | undefined,
): Promise<SharePostOutcome> {
  if (nav?.share) {
    let file: File | null = null;
    if (input.remoteImageUrl && input.remoteImageUrl.trim() !== '') {
      file = await fetchAsFile(input.remoteImageUrl, input.imageKey);
    }
    const filesPayload = file && (!nav.canShare || nav.canShare({ files: [file] })) ? [file] : undefined;
    try {
      if (filesPayload) {
        await nav.share({ title: input.title, text: input.message, url, files: filesPayload });
      } else {
        await nav.share({ title: input.title, text: input.message, url });
      }
      return { kind: 'shared' };
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'AbortError') return { kind: 'dismissed' };
      // Other Web Share failures fall through to the clipboard copy path below.
      console.warn('[sharePost] navigator.share failed', err instanceof Error ? err.message : err);
    }
  }
  if (nav?.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(url);
      return { kind: 'copied' };
    } catch (err) {
      return { kind: 'failed', reason: err instanceof Error ? err.message : 'clipboard_failed' };
    }
  }
  return { kind: 'failed', reason: 'no_share_api' };
}

const SHARE_IMAGE_DOWNLOAD_MS = 2_500;

async function withShareImageDownloadTimeout<T>(promise: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), SHARE_IMAGE_DOWNLOAD_MS);
      }),
    ]);
  } catch (err) {
    // A failed image download must not block the share sheet.
    console.warn('[sharePost] image download failed', err instanceof Error ? err.message : err);
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function shareLink(input: ShareLinkInput): Promise<SharePostOutcome> {
  const { url } = input;

  if (Platform.OS === 'web') {
    const nav = typeof navigator !== 'undefined' ? (navigator as unknown as WebShareNavigator) : undefined;
    return shareWeb(input, url, nav);
  }

  // iOS attaches the image binary via the `url` field; the share URL lives
  // inline in `message`. Android never passes `url` because RN concatenates
  // it onto EXTRA_TEXT, surfacing the link twice in WhatsApp.
  let localImageUri: string | undefined;
  if (Platform.OS === 'ios' && input.remoteImageUrl && input.remoteImageUrl.trim() !== '') {
    const downloaded = await withShareImageDownloadTimeout(
      downloadPostImageForShare(input.remoteImageUrl, input.imageKey),
    );
    localImageUri = downloaded?.uri;
  }

  try {
    const messageWithUrl = `${input.message}\n${url}`;
    if (localImageUri && Platform.OS === 'ios') {
      const result = await Share.share({
        message: messageWithUrl,
        url: localImageUri,
        title: input.title,
      });
      if (result.action === Share.dismissedAction) return { kind: 'dismissed' };
      return { kind: 'shared' };
    }
    const result = await Share.share({ message: messageWithUrl, title: input.title });
    if (result.action === Share.dismissedAction) return { kind: 'dismissed' };
    return { kind: 'shared' };
  } catch (err) {
    return { kind: 'failed', reason: err instanceof Error ? err.message : 'share_failed' };
  }
}

/** Shares a post: its canonical `/post/<id>` link, the composed text and its first photo. */
export async function sharePost(input: PostShareInput): Promise<SharePostOutcome> {
  return shareLink({
    url: buildPostShareUrl(input.postId, input.webBaseUrl),
    title: input.title,
    message: input.message,
    imageKey: input.postId,
    remoteImageUrl: input.remoteImageUrl,
  });
}
