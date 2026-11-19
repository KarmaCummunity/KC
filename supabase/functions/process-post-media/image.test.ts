import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { Jimp } from 'https://esm.sh/jimp@1.6.0';
import { encodePostImage } from './image.ts';

for (const mime of ['image/jpeg', 'image/png'] as const) {
  Deno.test(`real ${mime} decode/re-encode produces a readable 400px thumbnail`, async () => {
    const input = new Jimp({ width: 800, height: 600, color: 0xff0000ff });
    const bytes = new Uint8Array(await input.getBuffer(mime));
    const result = await encodePostImage(bytes, mime);
    const original = await Jimp.read(result.original.buffer as ArrayBuffer);
    const thumb = await Jimp.read(result.thumb.buffer as ArrayBuffer);
    assertEquals([original.width, original.height], [800, 600]);
    assertEquals([thumb.width, thumb.height], [400, 300]);
    assertEquals(result.original[0], mime === 'image/jpeg' ? 0xff : 0x89);
  });
}
Deno.test('invalid bytes and unsupported MIME fail instead of becoming ready', async () => {
  await assertRejects(() => encodePostImage(new Uint8Array([0, 1, 2]), 'image/jpeg'));
  await assertRejects(() => encodePostImage(new Uint8Array([0, 1, 2]), 'image/gif'));
});
