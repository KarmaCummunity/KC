// KC#873 — pick + upload chat images to `chat-media` bucket, then RPC media message.
// The bucket is private (#1064): the message stores only the object path, and viewers
// read it through a signed URL (`chatMediaUrl.ts`).

import * as ImagePicker from 'expo-image-picker';
import * as Crypto from 'expo-crypto';
import { encodeJpeg, planMaxEdgeResize, type ImageSize } from './imageEncoding';
import { uploadErrorMessage, uploadStorageObject } from './storageObjectUpload';

const BUCKET = 'chat-media';
const MAX_EDGE = 1600;
const COMPRESS = 0.85;

export interface PickedChatImage extends ImageSize {
  readonly uri: string;
}

export async function pickChatImage(): Promise<PickedChatImage | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'] as ImagePicker.MediaType[],
    quality: 1,
    exif: false,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  return { uri: asset.uri, width: asset.width, height: asset.height };
}

/**
 * Encodes (longer edge ≤ 1600, no upscaling), stores the image under the sender's folder, then
 * sends the media message. The upload has a time budget and retries transient failures, so a
 * dead connection ends in an error the thread can show instead of a silent wait.
 */
export async function uploadChatImageAndSend(
  chatId: string,
  userId: string,
  picked: PickedChatImage,
  sendRpc: (payload: Record<string, unknown>, caption?: string | null) => Promise<void>,
): Promise<void> {
  const encoded = await encodeJpeg(picked.uri, planMaxEdgeResize(picked, MAX_EDGE), COMPRESS);
  // userId first — matches storage RLS on (storage.foldername(name))[1] like other buckets.
  // A fresh object id per attempt: an aborted attempt that lands late is never the one we send.
  let path: string;
  try {
    path = await uploadStorageObject({
      bucket: BUCKET,
      pathForAttempt: () => `${userId}/${chatId}/${Crypto.randomUUID()}.jpg`,
      bytes: encoded.bytes,
      contentType: 'image/jpeg',
      cacheControl: 'private, max-age=31536000, immutable',
    });
  } catch (err) {
    throw new Error(`chat_media_upload: ${uploadErrorMessage(err)}`, { cause: err });
  }
  await sendRpc({
    type: 'image',
    path,
    width: encoded.width,
    height: encoded.height,
  });
}
