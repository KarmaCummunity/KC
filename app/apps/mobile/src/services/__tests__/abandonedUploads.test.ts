import { beforeEach, describe, expect, it, vi } from 'vitest';

/** An in-memory Storage bucket set and an AsyncStorage double, shared with the module under test. */
const { objects, kv, removeCalls, session } = vi.hoisted(() => ({
  objects: new Set<string>(),
  kv: new Map<string, string>(),
  removeCalls: [] as string[][],
  session: { userId: 'u1' as string | null, failRemove: false },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => kv.get(k) ?? null,
    setItem: async (k: string, v: string) => { kv.set(k, v); },
  },
}));
vi.mock('@kc/infrastructure-supabase', () => ({
  getSupabaseClient: () => ({
    auth: { getSession: async () => ({ data: { session: session.userId ? { user: { id: session.userId } } : null } }) },
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          removeCalls.push(paths.map((p) => `${bucket}/${p}`));
          if (session.failRemove) return { data: null, error: { message: 'offline' } };
          for (const p of paths) objects.delete(`${bucket}/${p}`);
          return { data: [], error: null };
        },
      }),
    },
  }),
}));

import { ABANDON_SETTLE_MS, abandonUpload, pendingAbandoned, sweepAbandonedUploads } from '../abandonedUploads';

const T0 = 1_000_000;

beforeEach(() => {
  objects.clear();
  kv.clear();
  removeCalls.length = 0;
  session.userId = 'u1';
  session.failRemove = false;
});

describe('abandoned uploads ledger', () => {
  it('a delete that runs BEFORE a late commit lands does not let the late object survive', async () => {
    // The attempt is aborted; the app deletes at once, while the server has not committed yet.
    await abandonUpload('post-images', 'u1/b/0.jpg', T0);
    expect(removeCalls).toEqual([['post-images/u1/b/0.jpg']]);
    // ...then the server commits the aborted request after all.
    objects.add('post-images/u1/b/0.jpg');
    // A sweep inside the settle window does not drop the entry (the write could still land).
    await sweepAbandonedUploads(T0 + ABANDON_SETTLE_MS - 1);
    expect(objects.has('post-images/u1/b/0.jpg')).toBe(true);
    expect(await pendingAbandoned()).toHaveLength(1);
    // After the window no late write can still arrive: the sweep deletes it and forgets the entry.
    await sweepAbandonedUploads(T0 + ABANDON_SETTLE_MS);
    expect(objects.has('post-images/u1/b/0.jpg')).toBe(false);
    expect(await pendingAbandoned()).toEqual([]);
  });

  it('keeps an entry whose delete failed and retries it on the next sweep', async () => {
    session.failRemove = true;
    await abandonUpload('chat-media', 'u1/c/x.jpg', T0);
    await sweepAbandonedUploads(T0 + ABANDON_SETTLE_MS);
    expect(await pendingAbandoned()).toHaveLength(1);
    session.failRemove = false;
    await sweepAbandonedUploads(T0 + ABANDON_SETTLE_MS + 1);
    expect(await pendingAbandoned()).toEqual([]);
  });

  it('an already-settled object (upload finished, never referenced) is deletable at once', async () => {
    objects.add('chat-media/u1/c/y.jpg');
    await abandonUpload('chat-media', 'u1/c/y.jpg', T0, { settled: true });
    await sweepAbandonedUploads(T0);
    expect(objects.has('chat-media/u1/c/y.jpg')).toBe(false);
    expect(await pendingAbandoned()).toEqual([]);
  });

  it('only sweeps the signed-in member\'s own entries, and never a path outside a member folder', async () => {
    await abandonUpload('avatars', 'u2/avatar-g1.jpg', T0);
    await abandonUpload('avatars', '../escape.jpg', T0);
    removeCalls.length = 0;
    await sweepAbandonedUploads(T0 + ABANDON_SETTLE_MS);
    expect(removeCalls).toEqual([]);
    session.userId = 'u2';
    await sweepAbandonedUploads(T0 + ABANDON_SETTLE_MS);
    expect(removeCalls).toEqual([['avatars/u2/avatar-g1.jpg']]);
  });

  it('serializes concurrent records: none is lost', async () => {
    await Promise.all(['a', 'b', 'c', 'd'].map((n) => abandonUpload('post-images', `u1/b/${n}.jpg`, T0)));
    expect((await pendingAbandoned()).map((e) => e.path).sort()).toEqual(['u1/b/a.jpg', 'u1/b/b.jpg', 'u1/b/c.jpg', 'u1/b/d.jpg']);
  });
});
