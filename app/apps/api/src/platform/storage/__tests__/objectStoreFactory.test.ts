import { describe, expect, it } from 'vitest';
import { GcsObjectStore } from '../gcsObjectStore';
import { LocalObjectStore } from '../localObjectStore';
import { createObjectStore } from '../objectStoreFactory';

const NONE = { localDirectory: null, publicUrl: null, cloud: null };

describe('createObjectStore', () => {
  it('gives no store when none is configured', async () => {
    expect(await createObjectStore(NONE, 'secret')).toBeNull();
    // The API's address alone names no store: it is only where a local store's URLs point.
    expect(await createObjectStore({ ...NONE, publicUrl: 'http://localhost:8080' }, 'secret')).toBeNull();
  });

  it('gives the local-directory store, whose addresses point back at the API', async () => {
    const store = await createObjectStore({ ...NONE, localDirectory: '/var/kc-files', publicUrl: 'http://localhost:8080' }, 'secret');

    expect(store).toBeInstanceOf(LocalObjectStore);
    expect(store?.publicUrl('avatars', 'u1/a.jpg')).toBe('http://localhost:8080/storage/v1/object/public/avatars/u1/a.jpg');
  });

  it('gives the Cloud Storage store, whose public addresses are on the media address; building it contacts nothing', async () => {
    const store = await createObjectStore({ ...NONE, cloud: { bucketPrefix: 'kc-dev-', mediaUrl: 'https://media.example.org' } }, 'secret');

    expect(store).toBeInstanceOf(GcsObjectStore);
    expect(store?.publicUrl('avatars', 'u1/a.jpg')).toBe('https://media.example.org/storage/v1/object/public/avatars/u1/a.jpg');
  });
});
