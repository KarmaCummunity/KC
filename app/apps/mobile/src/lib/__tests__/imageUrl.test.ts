process.env.EXPO_PUBLIC_SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://example.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'test-anon-key';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetApiBackendForTests } from '../../services/backend/apiBackend';
import { resetStorageBackendForTests } from '../../services/backend/storageBackend';
import {
  buildSupabaseImageTransformUrl,
  deriveThumbPath,
  deriveThumbUrl,
  getSupabaseFeedImageUrl,
  getSupabaseHeroImageUrl,
  getSupabaseImageThumbUrl,
  getSupabasePublicImageUrl,
} from '../imageUrl';

describe('getSupabasePublicImageUrl', () => {
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_USE_STORAGE_TRANSFORM;
  });

  it('uses CDN render URL when width/quality are provided and the build opted in (#897)', () => {
    process.env.EXPO_PUBLIC_USE_STORAGE_TRANSFORM = '1';
    const url = getSupabasePublicImageUrl({ bucket: 'post-images', path: 'a/b.jpg', width: 400, quality: 80 });
    expect(url).toContain('/storage/v1/render/image/public/post-images/a/b.jpg');
    expect(url).toContain('width=400');
    expect(url).toContain('format=webp');
  });

  it.each([undefined, '0', 'true'])('never asks for a paid transform unless the flag is exactly 1 (flag %s)', (flag) => {
    if (flag === undefined) delete process.env.EXPO_PUBLIC_USE_STORAGE_TRANSFORM;
    else process.env.EXPO_PUBLIC_USE_STORAGE_TRANSFORM = flag;
    const url = getSupabasePublicImageUrl({ bucket: 'post-images', path: 'a/b.jpg', width: 400, quality: 80 });
    expect(url).toContain('/storage/v1/object/public/post-images/a/b.jpg');
    expect(url).not.toContain('/render/image/');
  });

  it('omits transform params via /object/public/ when none given', () => {
    const url = getSupabasePublicImageUrl({ bucket: 'avatars', path: 'x/y.jpg' });
    expect(url).toContain('/storage/v1/object/public/avatars/x/y.jpg');
    expect(url).not.toContain('?width');
  });

  it('returns empty string for empty path', () => {
    expect(getSupabasePublicImageUrl({ bucket: 'post-images', path: '' })).toBe('');
  });

});

describe('getSupabasePublicImageUrl without env', () => {
  const savedUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const savedKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  afterEach(() => {
    if (savedUrl === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    else process.env.EXPO_PUBLIC_SUPABASE_URL = savedUrl;
    if (savedKey === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = savedKey;
  });

  it('returns empty string when Supabase env is missing', () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    expect(getSupabasePublicImageUrl({ bucket: 'post-images', path: 'a.jpg' })).toBe('');
  });
});

describe('buildSupabaseImageTransformUrl', () => {
  it('builds render URL with format and quality defaults', () => {
    const url = buildSupabaseImageTransformUrl({ bucket: 'post-images', path: 'a.jpg', width: 200 });
    expect(url).toBe(
      'https://example.supabase.co/storage/v1/render/image/public/post-images/a.jpg?width=200&quality=80&format=webp',
    );
  });
});

describe('getSupabaseFeedImageUrl', () => {
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_USE_STORAGE_TRANSFORM;
  });

  it('serves the 400 px -thumb sibling by default, never the 2048 px original', () => {
    expect(getSupabaseFeedImageUrl('post-images', 'u/b/0.jpg', 180)).toBe(
      'https://example.supabase.co/storage/v1/object/public/post-images/u/b/0-thumb.jpg',
    );
  });

  it('scales display width to 2x for retina when transforms are opted in', () => {
    process.env.EXPO_PUBLIC_USE_STORAGE_TRANSFORM = '1';
    const url = getSupabaseFeedImageUrl('post-images', 'p.jpg', 100);
    expect(url).toContain('width=200');
  });
});

describe('deriveThumbPath', () => {
  it('inserts -thumb before the extension', () => {
    expect(deriveThumbPath('a/b/c.jpg')).toBe('a/b/c-thumb.jpg');
  });
  it('handles avatar path layout', () => {
    expect(deriveThumbPath('uuid-1234/avatar.jpg')).toBe('uuid-1234/avatar-thumb.jpg');
  });
  it('handles post path layout (3 segments)', () => {
    expect(deriveThumbPath('user-id/batch-uuid/0.jpg')).toBe('user-id/batch-uuid/0-thumb.jpg');
  });
  it('returns the path unchanged when empty', () => {
    expect(deriveThumbPath('')).toBe('');
  });
  it('falls back to suffix when there is no extension', () => {
    expect(deriveThumbPath('a/b/c')).toBe('a/b/c-thumb');
  });
  it('does not confuse a dot inside a folder name for an extension', () => {
    expect(deriveThumbPath('foo.bar/baz')).toBe('foo.bar/baz-thumb');
  });
  it('handles multi-dot filenames by splitting on the last dot', () => {
    expect(deriveThumbPath('a/b/file.name.jpg')).toBe('a/b/file.name-thumb.jpg');
  });
});

describe('getSupabaseImageThumbUrl', () => {
  it('returns the public URL of the sibling -thumb object when no transform width', () => {
    const url = getSupabaseImageThumbUrl({ bucket: 'post-images', path: 'u/b/0.jpg' });
    expect(url).toBe('https://example.supabase.co/storage/v1/object/public/post-images/u/b/0-thumb.jpg');
  });
  it('returns empty string for empty path', () => {
    expect(getSupabaseImageThumbUrl({ bucket: 'avatars', path: '' })).toBe('');
  });
});

describe('deriveThumbUrl', () => {
  it('thumbifies a Supabase public storage URL with cache-bust query', () => {
    const input = 'https://example.supabase.co/storage/v1/object/public/avatars/uuid/avatar.jpg?v=1700000000000';
    expect(deriveThumbUrl(input)).toBe(
      'https://example.supabase.co/storage/v1/object/public/avatars/uuid/avatar-thumb.jpg?v=1700000000000',
    );
  });
  it('thumbifies a Supabase public storage URL without query', () => {
    const input = 'https://example.supabase.co/storage/v1/object/public/post-images/u/b/0.jpg';
    expect(deriveThumbUrl(input)).toBe(
      'https://example.supabase.co/storage/v1/object/public/post-images/u/b/0-thumb.jpg',
    );
  });
  it('passes Google OAuth avatar URLs through unchanged', () => {
    const input = 'https://lh3.googleusercontent.com/a/ACg8ocI...=s96-c';
    expect(deriveThumbUrl(input)).toBe(input);
  });
  it('passes other external URLs through unchanged', () => {
    const input = 'https://cdn.example.com/static/avatar.png';
    expect(deriveThumbUrl(input)).toBe(input);
  });
  it('returns input unchanged on parse failure', () => {
    expect(deriveThumbUrl('')).toBe('');
    expect(deriveThumbUrl('not a url')).toBe('not a url');
  });
});

describe('getSupabaseHeroImageUrl (post detail hero)', () => {
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_USE_STORAGE_TRANSFORM;
  });

  it('asks for a webp sized to twice the display width when transforms are opted in', () => {
    process.env.EXPO_PUBLIC_USE_STORAGE_TRANSFORM = '1';
    const url = getSupabaseHeroImageUrl('post-images', 'a/b.jpg', 390);
    expect(url).toContain('/storage/v1/render/image/public/post-images/a/b.jpg');
    expect(url).toContain('width=780');
    expect(url).toContain('format=webp');
  });

  it('caps very wide displays so a desktop window does not ask for the original', () => {
    process.env.EXPO_PUBLIC_USE_STORAGE_TRANSFORM = '1';
    expect(getSupabaseHeroImageUrl('post-images', 'a/b.jpg', 2000)).toContain('width=1600');
  });

  it('serves the original when transforms are off, never the blurry 400 px thumb', () => {
    process.env.EXPO_PUBLIC_USE_STORAGE_TRANSFORM = '0';
    const url = getSupabaseHeroImageUrl('post-images', 'a/b.jpg', 390);
    expect(url).toContain('/storage/v1/object/public/post-images/a/b.jpg');
    expect(url).not.toContain('-thumb');
  });

  it('has no URL for a missing path', () => {
    expect(getSupabaseHeroImageUrl('post-images', '', 390)).toBe('');
  });
});

describe('image URLs when the files are on KC\'s own storage', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_KC_API_URL = 'https://api.kc.test';
    process.env.EXPO_PUBLIC_KC_API_STORAGE = '1';
    process.env.EXPO_PUBLIC_KC_MEDIA_URL = 'https://media.kc.test';
    resetApiBackendForTests();
    resetStorageBackendForTests();
  });

  afterEach(() => {
    delete process.env.EXPO_PUBLIC_KC_API_URL;
    delete process.env.EXPO_PUBLIC_KC_API_STORAGE;
    delete process.env.EXPO_PUBLIC_KC_MEDIA_URL;
    delete process.env.EXPO_PUBLIC_USE_STORAGE_TRANSFORM;
    resetApiBackendForTests();
    resetStorageBackendForTests();
  });

  it('serves the same paths from the media domain', () => {
    expect(getSupabasePublicImageUrl({ bucket: 'post-images', path: 'a/b.jpg' })).toBe('https://media.kc.test/storage/v1/object/public/post-images/a/b.jpg');
    expect(deriveThumbUrl('https://media.kc.test/storage/v1/object/public/post-images/a/b.jpg')).toBe('https://media.kc.test/storage/v1/object/public/post-images/a/b-thumb.jpg');
  });

  it('uses the stored thumbnail in a feed even in a build that opted in to transforms: this host makes none', () => {
    process.env.EXPO_PUBLIC_USE_STORAGE_TRANSFORM = '1';

    expect(getSupabaseFeedImageUrl('post-images', 'a/b.jpg', 180)).toBe('https://media.kc.test/storage/v1/object/public/post-images/a/b-thumb.jpg');
    expect(getSupabaseHeroImageUrl('post-images', 'a/b.jpg', 390)).toBe('https://media.kc.test/storage/v1/object/public/post-images/a/b.jpg');
  });

  it('answers a direct request for a transform with the plain public address', () => {
    expect(buildSupabaseImageTransformUrl({ bucket: 'post-images', path: 'a/b.jpg', width: 200 })).toBe('https://media.kc.test/storage/v1/object/public/post-images/a/b.jpg');
  });
});

