// RN-friendly conversion of an ImageManipulator base64 JPEG to a typed-array
// Supabase Storage can upload as raw bytes.
//
// Why not `fetch(file://uri).blob()`? On iOS (RN 0.81 / SDK 54) the resulting
// Blob is intermittently empty — the upload completes against Storage but the
// stored file is 0 bytes, so the Image tag renders nothing. Going through
// `manipulateAsync({ base64: true })` + manual decode is the documented
// workaround in the Supabase RN guide.

const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const lookup = new Uint8Array(256);
for (let i = 0; i < chars.length; i++) {
  lookup[chars.codePointAt(i)!] = i;
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const len = base64.length;
  let bufferLength = base64.length * 0.75,
    i, p = 0,
    encoded1, encoded2, encoded3, encoded4;

  if (base64[base64.length - 1] === "=") {
    bufferLength--;
    if (base64[base64.length - 2] === "=") {
      bufferLength--;
    }
  }

  const bytes = new Uint8Array(bufferLength);

  for (i = 0; i < len; i += 4) {
    encoded1 = lookup[base64.codePointAt(i)!];
    encoded2 = lookup[base64.codePointAt(i + 1)!];
    encoded3 = lookup[base64.codePointAt(i + 2)!];
    encoded4 = lookup[base64.codePointAt(i + 3)!];

    bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
    bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
  }

  return bytes;
}
