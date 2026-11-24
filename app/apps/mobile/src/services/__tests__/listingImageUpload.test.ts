import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PickedImage } from '../imageUpload';

const { batch } = vi.hoisted(() => ({ batch: { uploadPostImageBatch: vi.fn() } }));

vi.mock('@kc/infrastructure-supabase', () => ({ getSupabaseClient: () => ({}) }));
// The file host the storage door builds public addresses on.
vi.mock('../../lib/supabasePublicConfig', () => ({ getSupabasePublicEnv: () => ({ url: 'https://p.supabase.co', anonKey: 'anon' }) }));
vi.mock('../imageUpload', () => ({
  pickPostImages: vi.fn(),
  uploadPostImageBatch: batch.uploadPostImageBatch,
}));

import { uploadListingImages, listingImagePublicUrl } from '../listingImageUpload';

const image = (i: number): PickedImage => ({ uri: `file:///img${i}.jpg`, width: 3000, height: 2000, fileSize: null });
const stored = (i: number) => ({
  status: 'fulfilled' as const,
  value: { path: `user-1/b/${i}.jpg`, mimeType: 'image/jpeg', sizeBytes: 10 + i, previewUri: `file:///img${i}.jpg` },
});

describe('listingImageUpload', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uploads through the post pipeline and answers each file\'s real path, type and size', async () => {
    batch.uploadPostImageBatch.mockResolvedValue([stored(0), stored(1)]);
    await expect(uploadListingImages('user-1', [image(0), image(1)])).resolves.toEqual([
      { path: 'user-1/b/0.jpg', mimeType: 'image/jpeg', sizeBytes: 10 },
      { path: 'user-1/b/1.jpg', mimeType: 'image/jpeg', sizeBytes: 11 },
    ]);
    expect(batch.uploadPostImageBatch).toHaveBeenCalledWith([image(0), image(1)], 'user-1');
  });

  it('caps the upload at five photos', async () => {
    batch.uploadPostImageBatch.mockResolvedValue([0, 1, 2, 3, 4].map(stored));
    await uploadListingImages('user-1', Array.from({ length: 7 }, (_, i) => image(i)));
    expect(batch.uploadPostImageBatch.mock.calls[0]?.[0]).toHaveLength(5);
  });

  it('rejects with the first failure reason', async () => {
    batch.uploadPostImageBatch.mockResolvedValue([stored(0), { status: 'rejected', reason: new Error('upload[1]: quota') }]);
    await expect(uploadListingImages('user-1', [image(0), image(1)])).rejects.toThrow('upload[1]: quota');
    batch.uploadPostImageBatch.mockResolvedValue([{ status: 'rejected', reason: 'offline' }]);
    await expect(uploadListingImages('user-1', [image(0)])).rejects.toThrow('offline');
  });

  it('builds the public URL of a stored photo', () => {
    expect(listingImagePublicUrl('u/b/0.jpg')).toBe('https://p.supabase.co/storage/v1/object/public/post-images/u/b/0.jpg');
  });
});
