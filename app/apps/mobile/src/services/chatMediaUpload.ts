// KC#873 — pick + upload chat images to `chat-media` bucket, then RPC media message.
// The bucket is private (#1064): the message stores only the object path, and viewers
// read it through a signed URL (`chatMediaUrl.ts`).

import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Crypto from 'expo-crypto';
import { getSupabaseClient } from '@kc/infrastructure-supabase';
import { base64ToUint8Array } from './mediaEncoding';

const BUCKET = 'chat-media';
const MAX_EDGE = 1600;
const COMPRESS = 0.85;

export async function pickChatImage(): Promise<{ uri: string } | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'] as ImagePicker.MediaType[],
    quality: 1,
    exif: false,
  });
  if (result.canceled || !result.assets[0]) return null;
  return { uri: result.assets[0].uri };
}

export async function uploadChatImageAndSend(
  chatId: string,
  userId: string,
  localUri: string,
  sendRpc: (payload: Record<string, unknown>, caption?: string | null) => Promise<void>,
): Promise<void> {
  const manipulated = await ImageManipulator.manipulateAsync(
    localUri,
    [{ resize: { width: MAX_EDGE } }],
    { compress: COMPRESS, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  if (!manipulated.base64) throw new Error('chat_media_encode_failed');
  const objectId = Crypto.randomUUID();
  // userId first — matches storage RLS on (storage.foldername(name))[1] like other buckets.
  const path = `${userId}/${chatId}/${objectId}.jpg`;
  const client = getSupabaseClient();
  const bytes = base64ToUint8Array(manipulated.base64);
  const { error: upErr } = await client.storage.from(BUCKET).upload(path, bytes, {
    contentType: 'image/jpeg',
    upsert: false,
    cacheControl: 'private, max-age=31536000, immutable',
  });
  if (upErr) throw new Error(`chat_media_upload: ${upErr.message}`);
  await sendRpc({
    type: 'image',
    path,
    width: manipulated.width,
    height: manipulated.height,
  });
}
