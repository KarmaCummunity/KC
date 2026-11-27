import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ObjectStore, ObjectTooLargeError } from '../objectStore';

// What every `ObjectStore` promises to the server modules that work on files
// (ADR-012 section 1), written once and run against each implementation: the
// local directory in every test run, Cloud Storage on its emulator in CI and
// on a real project before a deploy. A store that drifts from the others
// fails the same case they pass.

/** One implementation under test, with the buckets `avatars`, `post-images` and `chat-media` ready. */
export interface ObjectStoreLeg {
  readonly store: ObjectStore;
  /** The address public files are served from, as the store was configured. */
  readonly publicBaseUrl: string;
  /** Releases what the leg opened (a directory, buckets). */
  close(): Promise<void>;
}

const JPEG = { contentType: 'image/jpeg', cacheControl: null };
const bytesOf = (...values: number[]) => new Uint8Array(values);
const listOf = async (bytes: Promise<Uint8Array | null>) => Array.from((await bytes) ?? []);
/** A folder no other case or run writes under, so cases are independent and a shared bucket stays usable. */
const freshFolder = () => `contract-${randomUUID()}`;

/** The cases every store passes, on every backend it is tested on. */
export function describeObjectStoreContract(title: string, open: () => Promise<ObjectStoreLeg>): void {
  describe(`${title}: object store contract`, () => {
    let leg: ObjectStoreLeg;
    let store: ObjectStore;

    beforeAll(async () => {
      leg = await open();
      store = leg.store;
    });

    afterAll(async () => {
      await leg.close();
    });

    it('stores an object and gives back its bytes, size and type', async () => {
      const name = `${freshFolder()}/a.jpg`;

      expect(await store.write('avatars', name, bytesOf(1, 2, 3, 4), JPEG)).toBe(true);

      expect(await store.head('avatars', name)).toMatchObject({ size: 4, contentType: 'image/jpeg' });
      expect(await listOf(store.read('avatars', name))).toEqual([1, 2, 3, 4]);
    });

    it('never replaces an object: the second write of a name is refused and the first bytes stay', async () => {
      const name = `${freshFolder()}/once.jpg`;
      await store.write('avatars', name, bytesOf(1), JPEG);

      expect(await store.write('avatars', name, bytesOf(9, 9), JPEG)).toBe(false);
      expect(await listOf(store.read('avatars', name))).toEqual([1]);
    });

    it('knows nothing of an object that was never written, and deleting it is not an error', async () => {
      const name = `${freshFolder()}/missing.jpg`;

      expect(await store.head('avatars', name)).toBeNull();
      expect(await store.read('avatars', name)).toBeNull();
      await expect(store.delete('avatars', name)).resolves.toBeUndefined();
    });

    it('deletes an object, after which the name is free again', async () => {
      const name = `${freshFolder()}/gone.jpg`;
      await store.write('chat-media', name, bytesOf(7), JPEG);

      await store.delete('chat-media', name);

      expect(await store.head('chat-media', name)).toBeNull();
      expect(await store.write('chat-media', name, bytesOf(8), JPEG)).toBe(true);
    });

    it('keeps two buckets apart: the same name is two objects', async () => {
      const name = `${freshFolder()}/same.jpg`;
      await store.write('avatars', name, bytesOf(1), JPEG);
      await store.write('post-images', name, bytesOf(2), JPEG);

      expect(await listOf(store.read('avatars', name))).toEqual([1]);
      expect(await listOf(store.read('post-images', name))).toEqual([2]);
    });

    it('hands over nothing of an object larger than the reader said it would take', async () => {
      const name = `${freshFolder()}/large.jpg`;
      await store.write('post-images', name, bytesOf(1, 2, 3, 4, 5), JPEG);

      await expect(store.read('post-images', name, { maxBytes: 4 })).rejects.toBeInstanceOf(ObjectTooLargeError);
      expect(await listOf(store.read('post-images', name, { maxBytes: 5 }))).toEqual([1, 2, 3, 4, 5]);
    });

    it('lists the objects under a name prefix at any depth, in name order, with size and creation time', async () => {
      const folder = freshFolder();
      for (const name of ['u2/y.jpg', 'u1/b/d e.jpg', 'u1/a.jpg', 'u10/x.jpg', 'u1/b/c.jpg']) await store.write('post-images', `${folder}/${name}`, bytesOf(1, 2), JPEG);

      const page = await store.list('post-images', `${folder}/`, { limit: 100 });

      expect(page.entries.map((entry) => entry.name.slice(folder.length + 1))).toEqual(['u1/a.jpg', 'u1/b/c.jpg', 'u1/b/d e.jpg', 'u10/x.jpg', 'u2/y.jpg']);
      expect(page.entries.every((entry) => entry.size === 2 && Math.abs(entry.createdAt.getTime() - Date.now()) < 60_000)).toBe(true);
      expect(page.nextPageToken).toBeNull();
    });

    it('narrows a listing by its prefix: a folder with its slash does not take in a folder that merely starts alike', async () => {
      const folder = freshFolder();
      for (const name of ['u1/a.jpg', 'u1/b/c.jpg', 'u10/x.jpg']) await store.write('post-images', `${folder}/${name}`, bytesOf(1), JPEG);
      const namesUnder = async (prefix: string) => (await store.list('post-images', `${folder}/${prefix}`, { limit: 100 })).entries.map((entry) => entry.name.slice(folder.length + 1));

      expect(await namesUnder('u1/')).toEqual(['u1/a.jpg', 'u1/b/c.jpg']);
      expect(await namesUnder('u1/b/')).toEqual(['u1/b/c.jpg']);
      expect(await namesUnder('nobody/')).toEqual([]);
    });

    it('builds the lasting address of a public file in the shared shape, every path segment escaped', () => {
      expect(store.publicUrl('avatars', 'u1/my photo#1.jpg')).toBe(`${leg.publicBaseUrl}/storage/v1/object/public/avatars/u1/my%20photo%231.jpg`);
    });
  });
}

/**
 * Listings in pages. Apart from the cases above because Cloud Storage's
 * emulator answers one page only: it runs on the local store and on a real
 * project.
 */
export function describeObjectStorePaging(title: string, open: () => Promise<ObjectStoreLeg>): void {
  describe(`${title}: object store paging`, () => {
    let leg: ObjectStoreLeg;

    beforeAll(async () => {
      leg = await open();
    });

    afterAll(async () => {
      await leg.close();
    });

    it('pages through a listing, and removing what a page listed does not disturb the next', async () => {
      const folder = freshFolder();
      const names = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'].map((name) => `${folder}/${name}`);
      for (const name of names) await leg.store.write('post-images', name, bytesOf(1), JPEG);

      const first = await leg.store.list('post-images', `${folder}/`, { limit: 2 });
      await leg.store.delete('post-images', names[0] as string);
      const second = await leg.store.list('post-images', `${folder}/`, { limit: 2, pageToken: first.nextPageToken as string });
      const third = await leg.store.list('post-images', `${folder}/`, { limit: 2, pageToken: second.nextPageToken as string });

      expect(first.entries.map((entry) => entry.name)).toEqual(names.slice(0, 2));
      expect(second.entries.map((entry) => entry.name)).toEqual(names.slice(2, 4));
      expect([third.entries.map((entry) => entry.name), third.nextPageToken]).toEqual([names.slice(4), null]);
    });
  });
}

/**
 * The Cache-Control value kept with an object. Apart from the cases above
 * because Cloud Storage's emulator does not record it: it runs on the local
 * store and on a real project.
 */
export function describeObjectStoreCacheControl(title: string, open: () => Promise<ObjectStoreLeg>): void {
  describe(`${title}: object store Cache-Control`, () => {
    let leg: ObjectStoreLeg;

    beforeAll(async () => {
      leg = await open();
    });

    afterAll(async () => {
      await leg.close();
    });

    it('keeps the Cache-Control value an object was stored with, and none when none was given', async () => {
      const folder = freshFolder();
      await leg.store.write('avatars', `${folder}/cached.jpg`, bytesOf(1), { contentType: 'image/jpeg', cacheControl: 'public, max-age=60' });
      await leg.store.write('avatars', `${folder}/plain.jpg`, bytesOf(1), JPEG);

      expect(await leg.store.head('avatars', `${folder}/cached.jpg`)).toEqual({ size: 1, contentType: 'image/jpeg', cacheControl: 'public, max-age=60' });
      expect(await leg.store.head('avatars', `${folder}/plain.jpg`)).toEqual({ size: 1, contentType: 'image/jpeg', cacheControl: null });
    });
  });
}
