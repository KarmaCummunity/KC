// PRIVATE prototype. Stream cap applies even without Content-Length; callers own fetch/overall deadlines.
export const MAX_PRIVATE_PHOTO_BYTES = 5 * 1024 * 1024;
export async function privatePhotoBlob(response: Response): Promise<Blob> {
  const mime = response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase();
  if (!response.ok || mime !== 'image/jpeg' || !response.body) throw new Error('private_photo_refused');
  const declared = response.headers.get('Content-Length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_PRIVATE_PHOTO_BYTES)) {
    await response.body.cancel(); throw new Error('private_photo_size_refused');
  }
  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_PRIVATE_PHOTO_BYTES) throw new Error('private_photo_size_refused');
      chunks.push(new Uint8Array(next.value).buffer);
    }
    if (total === 0) throw new Error('private_photo_empty');
    return new Blob(chunks, { type: 'image/jpeg' });
  } catch (error) {
    await reader.cancel().catch(() => {}); throw error;
  } finally { reader.releaseLock(); }
}
