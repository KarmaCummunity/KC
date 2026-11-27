import { describe, expect, it } from 'vitest';
import { isPublicObjectUrl, publicObjectName, publicObjectUrl } from '../storageWire';

describe('public file addresses', () => {
  it('builds an address under the public path, escaping each segment and ignoring a trailing slash of the host', () => {
    expect(publicObjectUrl('https://media.kc.test/', 'avatars', 'u1/my photo#1.jpg')).toBe('https://media.kc.test/storage/v1/object/public/avatars/u1/my%20photo%231.jpg');
  });

  it('reads the name back from an address, whatever host served it', () => {
    const name = 'u1/my photo#1.jpg';

    expect(publicObjectName(publicObjectUrl('https://media.kc.test', 'avatars', name), 'avatars')).toBe(name);
    // An address written while the files were on another host names the same file.
    expect(publicObjectName('https://abc.supabase.co/storage/v1/object/public/avatars/u1/a.jpg?v=2#top', 'avatars')).toBe('u1/a.jpg');
  });

  it('answers null for an address of another bucket, of no bucket, or that is not an address', () => {
    expect(publicObjectName('https://media.kc.test/storage/v1/object/public/post-images/u1/a.jpg', 'avatars')).toBeNull();
    expect(publicObjectName('https://media.kc.test/storage/v1/object/public/avatars/', 'avatars')).toBeNull();
    expect(publicObjectName('https://example.org/a.jpg', 'avatars')).toBeNull();
    expect(publicObjectName('https://media.kc.test/storage/v1/object/public/avatars/%E0%A4%A', 'avatars')).toBeNull();
  });

  it('tells a public file address from any other', () => {
    expect(isPublicObjectUrl('https://x.test/storage/v1/object/public/avatars/a.jpg')).toBe(true);
    expect(isPublicObjectUrl('https://x.test/storage/v1/object/sign/chat-media/a.jpg')).toBe(false);
    expect(isPublicObjectUrl('file:///tmp/a.jpg')).toBe(false);
  });
});
