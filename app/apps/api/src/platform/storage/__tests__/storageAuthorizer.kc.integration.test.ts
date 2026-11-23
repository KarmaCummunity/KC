import { SupabaseChatRepository } from '@kc/infrastructure-supabase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KC_DATABASE_URL, KcTestDatabase, type TestMember } from '../../../__tests__/support/kcDatabase';
import { IdentityDatabase } from '../../database/identityDatabase';
import { isSafeObjectName, MAX_OBJECT_NAME_LENGTH, StorageAuthorizer } from '../storageAuthorizer';

/**
 * Who may write, read or delete which stored file, decided by the real
 * policies on `storage.objects` (ADR-012 section 3): each bucket's rule for
 * the member it is for, and for another member.
 */
describe.skipIf(!KC_DATABASE_URL)('StorageAuthorizer on the KC policies', () => {
  const database = new KcTestDatabase();
  const authorizer = new StorageAuthorizer(new IdentityDatabase(database.admin));
  let alice: TestMember;
  let bob: TestMember;
  let outsider: TestMember;
  /** A direct chat between Alice and Bob. */
  let chatId: string;

  const storedObjects = async () => Number((await database.admin.query<{ count: string }>('select count(*) from storage.objects')).rows[0]?.count);

  beforeAll(async () => {
    [alice, bob, outsider] = await Promise.all([database.newMember(), database.newMember(), database.newMember()]);
    chatId = (await new SupabaseChatRepository(database.clientFor(alice.caller)).findOrCreateChat(alice.userId, bob.userId)).chatId;
  });

  afterAll(async () => {
    await database.close();
  });

  it('reads a bucket\'s rules, and knows no bucket that is not registered', async () => {
    expect(await authorizer.bucketRules('avatars')).toMatchObject({ isPublic: true });
    expect(await authorizer.bucketRules('chat-media')).toMatchObject({ isPublic: false });
    expect(await authorizer.bucketRules('no-such-bucket')).toBeNull();
  });

  it.each(['avatars', 'post-images'])('lets a member upload and delete under their own folder of %s, and nobody else\'s', async (bucket) => {
    const own = `${alice.userId}/photo.jpg`;

    expect(await authorizer.mayUpload(alice.caller, bucket, own)).toBe(true);
    expect(await authorizer.mayDelete(alice.caller, bucket, own)).toBe(true);
    expect(await authorizer.mayUpload(bob.caller, bucket, own)).toBe(false);
    expect(await authorizer.mayDelete(bob.caller, bucket, own)).toBe(false);
    // A public bucket's files are readable by anyone who has the address, signed in or not.
    expect(await authorizer.mayRead(null, bucket, own)).toBe(true);
  });

  it('keeps the server-made copies of post photos out of every member\'s hands', async () => {
    const derived = `derived/${alice.userId}/photo.jpg`;

    expect(await authorizer.mayUpload(alice.caller, 'post-images', derived)).toBe(false);
    expect(await authorizer.mayDelete(alice.caller, 'post-images', derived)).toBe(false);
    // Case and a leading slash do not get around the rule.
    expect(await authorizer.mayUpload(alice.caller, 'post-images', `Derived/${alice.userId}/photo.jpg`)).toBe(false);
  });

  it('lets a chat\'s members attach and read its files, and keeps an outsider out', async () => {
    const attachment = `${alice.userId}/${chatId}/voice.m4a`;

    expect(await authorizer.mayUpload(alice.caller, 'chat-media', attachment)).toBe(true);
    // The other member reads it; only the member who sent it may delete it.
    expect(await authorizer.mayRead(bob.caller, 'chat-media', attachment)).toBe(true);
    expect(await authorizer.mayDelete(bob.caller, 'chat-media', attachment)).toBe(false);
    expect(await authorizer.mayDelete(alice.caller, 'chat-media', attachment)).toBe(true);
    expect(await authorizer.mayRead(outsider.caller, 'chat-media', attachment)).toBe(false);
    expect(await authorizer.mayRead(null, 'chat-media', attachment)).toBe(false);
    // A member cannot attach to a chat they are not in, even under their own folder.
    expect(await authorizer.mayUpload(outsider.caller, 'chat-media', `${outsider.userId}/${chatId}/x.jpg`)).toBe(false);
  });

  it('refuses an unknown bucket and a name that is not a plain relative path, before any policy is asked', async () => {
    const own = `${alice.userId}/photo.jpg`;

    expect(await authorizer.mayUpload(alice.caller, 'no-such-bucket', own)).toBe(false);
    expect(await authorizer.mayRead(alice.caller, 'no-such-bucket', own)).toBe(false);
    expect(await authorizer.mayDelete(alice.caller, 'no-such-bucket', own)).toBe(false);
    for (const name of [`${alice.userId}/../${bob.userId}/photo.jpg`, `/${alice.userId}/photo.jpg`, `${alice.userId}//photo.jpg`, `${alice.userId}/`, '']) {
      expect(await authorizer.mayUpload(alice.caller, 'avatars', name), name).toBe(false);
    }
  });

  it('leaves no trace: asking stores no row', async () => {
    const before = await storedObjects();

    await authorizer.mayUpload(alice.caller, 'avatars', `${alice.userId}/a.jpg`);
    await authorizer.mayRead(bob.caller, 'chat-media', `${alice.userId}/${chatId}/b.jpg`);
    await authorizer.mayDelete(alice.caller, 'post-images', `${alice.userId}/c.jpg`);

    expect(await storedObjects()).toBe(before);
  });
});

describe('isSafeObjectName', () => {
  it('accepts plain relative paths and refuses everything that climbs, is rooted, empty or unprintable', () => {
    expect(['a.jpg', 'folder/a.jpg', 'a/b/c.d.e'].map(isSafeObjectName)).toEqual([true, true, true]);
    expect(['', '/a', 'a/', 'a//b', '../a', 'a/../b', './a', 'a\nb', 'x'.repeat(MAX_OBJECT_NAME_LENGTH + 1)].map(isSafeObjectName)).toEqual(Array(9).fill(false));
  });
});
