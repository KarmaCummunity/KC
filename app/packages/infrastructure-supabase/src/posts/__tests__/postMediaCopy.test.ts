import { describe, expect, it, vi } from 'vitest';
import type { MediaAsset } from '@kc/domain';
import { copiedPhotoPath, copyPostPhotos, thumbPathOf } from '../postMediaCopy';

const photo = (path: string, over: Partial<MediaAsset> = {}): MediaAsset => ({
  mediaAssetId: path,
  postId: 'old',
  bucket: 'post-images',
  path,
  mimeType: 'image/jpeg',
  sizeBytes: 1234,
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
});

function fakeStorage(failUpload: (path: string) => boolean = () => false) {
  const uploads: string[] = [];
  const client = {
    storage: {
      from: (bucket: string) => ({
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn/${bucket}/${path}` } }),
        upload: async (path: string) => {
          if (failUpload(path)) return { error: { message: 'denied' } };
          uploads.push(path);
          return { error: null };
        },
      }),
    },
  };
  return { client: client as never, uploads };
}

const fetchOk = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }));

describe('copyPostPhotos (FR-POST-013 AC3)', () => {
  it('copies each photo and its thumbnail into a fresh batch of the owner, keeping type and size', async () => {
    const { client, uploads } = fakeStorage();
    const copies = await copyPostPhotos(client, 'u1', [photo('u1/b0/0.jpg'), photo('u1/b0/1.jpg', { sizeBytes: 99 })], 'nb', fetchOk);

    expect(copies).toEqual([
      { path: 'u1/nb/0.jpg', mimeType: 'image/jpeg', sizeBytes: 1234 },
      { path: 'u1/nb/1.jpg', mimeType: 'image/jpeg', sizeBytes: 99 },
    ]);
    expect(uploads).toEqual(['u1/nb/0.jpg', 'u1/nb/0-thumb.jpg', 'u1/nb/1.jpg', 'u1/nb/1-thumb.jpg']);
    expect(fetchOk).toHaveBeenCalledWith('https://cdn/post-images/u1/b0/0.jpg');
  });

  it('leaves out a photo it cannot read or write, and files that are not the owner\'s', async () => {
    let attempts = 0;
    const { client } = fakeStorage(() => (attempts += 1) === 1);
    const notFound = vi.fn(async (url: string) => ({ ok: !url.endsWith('gone.jpg'), arrayBuffer: async () => new ArrayBuffer(1) }));
    const copies = await copyPostPhotos(
      client,
      'u1',
      [photo('u1/b0/a.jpg'), photo('u1/b0/gone.jpg'), photo('u2/b0/x.jpg'), photo('u1/b0/l.jpg', { bucket: 'listing-images' }), photo('u1/b0/b.jpg')],
      'nb',
      notFound,
    );
    expect(copies.map((c) => c.path)).toEqual(['u1/nb/0.jpg']); // b.jpg, after a.jpg failed
  });
});

describe('photo paths', () => {
  it('follow the upload convention', () => {
    expect(thumbPathOf('u1/b/0.jpg')).toBe('u1/b/0-thumb.jpg');
    expect(copiedPhotoPath('u1', 'nb', 2, 'u1/b/0.png')).toBe('u1/nb/2.png');
  });
});
