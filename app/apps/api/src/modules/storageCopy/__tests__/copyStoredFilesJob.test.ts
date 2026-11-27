import { describe, expect, it } from 'vitest';
import type { IdentityDatabase } from '../../../platform/database/identityDatabase';
import type { AppLogger } from '../../../platform/logging/appLogger';
import type { ObjectStore } from '../../../platform/storage/objectStore';
import { NoObjectStoreError, type StorageAdmin } from '../../../platform/storage/storageAdmin';
import { md5OfEntityTag } from '../copyIndex';
import type { CopySource } from '../copyStoredFiles';
import { CopyStoredFilesJob, cursorOf, NoCopySourceError } from '../copyStoredFilesJob';

describe('md5OfEntityTag', () => {
  it.each([
    ['"9E107D9D372BB6826BD81D3542A419D6"', '9e107d9d372bb6826bd81d3542a419d6'],
    ['9e107d9d372bb6826bd81d3542a419d6', '9e107d9d372bb6826bd81d3542a419d6'],
  ])('reads the checksum of a file sent in one piece: %s', (tag, md5) => {
    expect(md5OfEntityTag(tag)).toBe(md5);
  });

  it.each([['"9e107d9d372bb6826bd81d3542a419d6-3"'], ['"abc"'], ['W/"9e107d9d372bb6826bd81d3542a419d6"'], [''], [null]])('reads none from a tag that is not a plain checksum: %s', (tag) => {
    expect(md5OfEntityTag(tag)).toBeNull();
  });
});

describe('cursorOf', () => {
  it('reads the cursor a run answered with', () => {
    expect(cursorOf({ bucket: 'avatars', after: 'u1/a.jpg' })).toEqual({ bucket: 'avatars', after: 'u1/a.jpg' });
    expect(cursorOf({ bucket: 'avatars', after: null })).toEqual({ bucket: 'avatars', after: null });
  });

  it.each([[undefined], [null], ['avatars'], [{}], [{ bucket: 7, after: null }], [{ bucket: 'avatars' }], [{ bucket: 'avatars', after: 3 }]])('starts from the beginning for anything else: %j', (value) => {
    expect(cursorOf(value)).toBeNull();
  });
});

describe('CopyStoredFilesJob', () => {
  // Stand-ins that fail the test if a run reaches them: a run that lacks a store or a source must stop before any work.
  const untouched = <T extends object>() => new Proxy({} as T, { get: (_target, member) => () => Promise.reject(new Error(`unexpected call: ${String(member)}`)) });
  const jobWith = (store: ObjectStore | null, source: CopySource | null) =>
    new CopyStoredFilesJob(store, source, untouched<StorageAdmin>(), untouched<IdentityDatabase>(), untouched<AppLogger>());

  it('fails its run on a server that has no file store', async () => {
    await expect(jobWith(null, untouched<CopySource>()).run({})).rejects.toBeInstanceOf(NoObjectStoreError);
  });

  it('fails its run on a server that was not told where the files live today', async () => {
    await expect(jobWith(untouched<ObjectStore>(), null).run({})).rejects.toBeInstanceOf(NoCopySourceError);
  });
});
