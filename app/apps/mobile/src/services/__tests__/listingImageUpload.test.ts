import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PickedImage } from '../imageUpload';

(globalThis as unknown as { __DEV__?: boolean }).__DEV__ = true;

const mockUpload = vi.fn();
const mockGetPublicUrl = vi.fn();
const mockManipulateAsync = vi.fn();

const mockClient = {
  storage: {
    from: vi.fn(() => ({
      upload: mockUpload,
      getPublicUrl: mockGetPublicUrl,
    })),
  },
};

vi.mock('@kc/infrastructure-supabase', () => ({
  getSupabaseClient: () => mockClient,
}));

vi.mock('expo-crypto', () => ({
  randomUUID: () => 'batch-uuid-1',
}));

vi.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
}));

vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: (...args: unknown[]) => mockManipulateAsync(...args),
  SaveFormat: { JPEG: 'jpeg' },
}));

vi.mock('../mediaEncoding', () => ({
  base64ToUint8Array: (b64: string) => new Uint8Array(Buffer.from(b64, 'base64')),
}));

vi.mock('../imageUpload', () => ({
  buildPostImagePath: (userId: string, batch: string, index: number) =>
    `${userId}/${batch}/${index}.jpg`,
  pickPostImages: vi.fn(),
}));

import { uploadListingImages, listingImagePublicUrl } from '../listingImageUpload';

const sampleImages: PickedImage[] = [
  { uri: 'file:///img0.jpg', width: 3000, height: 2000, fileSize: null },
  { uri: 'file:///img1.jpg', width: 3000, height: 2000, fileSize: null },
];

describe('listingImageUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('uploadListingImages', () => {
    it('compresses and uploads images to the post-images bucket', async () => {
      mockManipulateAsync.mockResolvedValue({ base64: Buffer.from('jpeg-bytes').toString('base64') });
      mockUpload.mockResolvedValue({ error: null });

      const paths = await uploadListingImages('user-1', sampleImages);

      expect(paths).toEqual(['user-1/batch-uuid-1/0.jpg', 'user-1/batch-uuid-1/1.jpg']);
      expect(mockClient.storage.from).toHaveBeenCalledWith('post-images');
      expect(mockUpload).toHaveBeenCalledTimes(2);
      expect(mockUpload).toHaveBeenCalledWith(
        'user-1/batch-uuid-1/0.jpg',
        expect.any(Uint8Array),
        {
          contentType: 'image/jpeg',
          upsert: false,
          cacheControl: 'public, max-age=31536000, immutable',
        },
      );
    });

    it('caps upload to MAX_LISTING_IMAGES (5 items)', async () => {
      mockManipulateAsync.mockResolvedValue({ base64: Buffer.from('img').toString('base64') });
      mockUpload.mockResolvedValue({ error: null });

      const sevenImages = Array.from({ length: 7 }, (_, i) => ({
        uri: `file:///img${i}.jpg`,
        width: 1000,
        height: 1000,
        fileSize: null,
      }));

      const paths = await uploadListingImages('user-1', sevenImages);

      expect(paths).toHaveLength(5);
      expect(mockUpload).toHaveBeenCalledTimes(5);
    });

    it('throws when image manipulator fails to produce base64', async () => {
      mockManipulateAsync.mockResolvedValueOnce({ base64: null });

      await expect(uploadListingImages('user-1', [sampleImages[0]!])).rejects.toThrow(
        'listing_image: no base64',
      );
    });

    it('throws when storage upload returns an error', async () => {
      mockManipulateAsync.mockResolvedValue({ base64: Buffer.from('img').toString('base64') });
      mockUpload.mockResolvedValueOnce({ error: { message: 'Storage bucket quota exceeded' } });

      await expect(uploadListingImages('user-1', [sampleImages[0]!])).rejects.toThrow(
        'Storage bucket quota exceeded',
      );
    });
  });

  describe('listingImagePublicUrl', () => {
    it('returns publicUrl from Supabase storage', () => {
      mockGetPublicUrl.mockReturnValueOnce({
        data: { publicUrl: 'https://cdn.example.com/post-images/u/b/0.jpg' },
      });

      const url = listingImagePublicUrl('u/b/0.jpg');

      expect(mockClient.storage.from).toHaveBeenCalledWith('post-images');
      expect(mockGetPublicUrl).toHaveBeenCalledWith('u/b/0.jpg');
      expect(url).toBe('https://cdn.example.com/post-images/u/b/0.jpg');
    });
  });
});
