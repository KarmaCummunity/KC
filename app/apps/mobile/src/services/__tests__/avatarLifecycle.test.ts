import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ledger } = vi.hoisted(() => ({
  ledger: { abandonUpload: vi.fn(async (_bucket: string, _path: string, _now?: number, _opts?: { settled?: boolean }) => undefined) },
}));
vi.mock('../abandonedUploads', () => ledger);

import { discardUnsavedAvatar, retirePreviousAvatar } from '../avatarLifecycle';

const base = 'https://p.supabase.co/storage/v1/object/public/avatars/';
const OLD = `${base}u1/avatar-old.jpg`;
const NEW = `${base}u1/avatar-new.jpg`;
const NEWER = `${base}u1/avatar-newer.jpg`;

beforeEach(() => vi.clearAllMocks());

describe('retirePreviousAvatar', () => {
  it('deletes the previous generation and its thumb once the profile points at the new one', async () => {
    const outcome = await retirePreviousAvatar({ userId: 'u1', previousUrl: OLD, committedUrl: NEW, readCurrentAvatarUrl: async () => NEW });
    expect(outcome).toBe('delete_queued');
    expect(ledger.abandonUpload.mock.calls.map((c) => c.slice(0, 2))).toEqual([
      ['avatars', 'u1/avatar-old.jpg'],
      ['avatars', 'u1/avatar-old-thumb.jpg'],
    ]);
  });

  it('a concurrent replacement (profile already points elsewhere) deletes nothing', async () => {
    const outcome = await retirePreviousAvatar({ userId: 'u1', previousUrl: OLD, committedUrl: NEW, readCurrentAvatarUrl: async () => NEWER });
    expect(outcome).toBe('skipped_reference_changed');
    expect(ledger.abandonUpload).not.toHaveBeenCalled();
  });

  it('never deletes an object the profile still references, the same object, or one that is not ours', async () => {
    expect(await retirePreviousAvatar({ userId: 'u1', previousUrl: OLD, committedUrl: OLD, readCurrentAvatarUrl: async () => OLD })).toBe('skipped_same');
    expect(await retirePreviousAvatar({ userId: 'u1', previousUrl: OLD, committedUrl: NEW, readCurrentAvatarUrl: async () => OLD })).toBe('skipped_reference_changed');
    expect(await retirePreviousAvatar({ userId: 'u1', previousUrl: 'https://lh3.googleusercontent.com/a/x', committedUrl: NEW, readCurrentAvatarUrl: async () => NEW })).toBe('skipped_not_ours');
    expect(await retirePreviousAvatar({ userId: 'u1', previousUrl: `${base}u2/avatar-x.jpg`, committedUrl: NEW, readCurrentAvatarUrl: async () => NEW })).toBe('skipped_not_ours');
    expect(ledger.abandonUpload).not.toHaveBeenCalled();
  });

  it('skips when the current reference cannot be read, and a delete failure never throws', async () => {
    expect(await retirePreviousAvatar({ userId: 'u1', previousUrl: OLD, committedUrl: NEW, readCurrentAvatarUrl: async () => { throw new Error('offline'); } })).toBe('skipped_reference_unknown');
    ledger.abandonUpload.mockRejectedValueOnce(new Error('storage down'));
    await expect(retirePreviousAvatar({ userId: 'u1', previousUrl: OLD, committedUrl: NEW, readCurrentAvatarUrl: async () => NEW })).resolves.toBe('delete_failed');
  });

  it('also retires a legacy fixed-path avatar (cache-busted URL)', async () => {
    await retirePreviousAvatar({ userId: 'u1', previousUrl: `${base}u1/avatar.jpg?v=1700`, committedUrl: NEW, readCurrentAvatarUrl: async () => NEW });
    expect(ledger.abandonUpload.mock.calls.map((c) => c[1])).toEqual(['u1/avatar.jpg', 'u1/avatar-thumb.jpg']);
  });
});

describe('discardUnsavedAvatar', () => {
  it('deletes an uploaded generation the profile never saved', async () => {
    expect(await discardUnsavedAvatar({ userId: 'u1', uploadedUrl: NEW, readCurrentAvatarUrl: async () => OLD })).toBe('delete_queued');
    expect(ledger.abandonUpload.mock.calls.map((c) => c[1])).toEqual(['u1/avatar-new.jpg', 'u1/avatar-new-thumb.jpg']);
  });
  it('keeps it when the profile does reference it (saved elsewhere meanwhile) or cannot be read', async () => {
    expect(await discardUnsavedAvatar({ userId: 'u1', uploadedUrl: NEW, readCurrentAvatarUrl: async () => NEW })).toBe('skipped_still_referenced');
    expect(await discardUnsavedAvatar({ userId: 'u1', uploadedUrl: NEW, readCurrentAvatarUrl: async () => { throw new Error('x'); } })).toBe('skipped_reference_unknown');
    expect(ledger.abandonUpload).not.toHaveBeenCalled();
  });
});
