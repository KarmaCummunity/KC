import { Jimp } from 'https://esm.sh/jimp@1.6.0';

export async function encodePostImage(bytes: Uint8Array, mime: string): Promise<{ original: Uint8Array; thumb: Uint8Array }> {
    if (mime !== 'image/jpeg' && mime !== 'image/png') throw new Error('unsupported_image_type');
    const img = await Jimp.read(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    // Preserve dimensions and MIME: existing media hints and URLs stay valid.
    // Fresh encodings contain only decoded pixels, not the source EXIF metadata.
    const original = new Uint8Array(await (mime === 'image/jpeg' ? img.getBuffer('image/jpeg', { quality: 85 }) : img.getBuffer('image/png')));
    const ratio = Math.min(400 / img.width, 400 / img.height, 1);
    if (ratio < 1) img.resize({ w: Math.max(1, Math.round(img.width * ratio)), h: Math.max(1, Math.round(img.height * ratio)) });
    const thumb = new Uint8Array(await (mime === 'image/jpeg' ? img.getBuffer('image/jpeg', { quality: 75 }) : img.getBuffer('image/png')));
    return { original, thumb };
}
