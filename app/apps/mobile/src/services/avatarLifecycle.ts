// Avatar generations after an upload (FR-AUTH-011, privacy). Each upload writes a NEW public
// object (`<user>/avatar-<uuid>.jpg` + `-thumb`). Without cleanup, a replaced avatar, or one
// picked and then never saved, would stay publicly fetchable at its URL forever.
//
// Rule: delete only what is provably unreferenced, and skip on any doubt.
//   * The only stored reference to an avatar object is the member's own `users.avatar_url`
//     (every other avatar field in the schema is read from it at query time).
//   * Before deleting, the profile row is re-read from the server. A previous generation is
//     retired only when the row points at the NEW committed URL (a concurrent replacement, or a
//     failed read, means skip). An unsaved upload is discarded only when the row does not point
//     at it.
//   * Deletion goes through the abandoned-uploads ledger, so a failed delete is retried later.
//     The outcome is therefore "queued", never a confirmed removal.
// Other members may still show the old image from a cache until they refresh; that is the
// intended effect of a replacement.

import { deriveThumbPath } from '../lib/imageUrl';
import { abandonUpload } from './abandonedUploads';
import { publicFilePath } from './backend/storageBackend';

const AVATAR_BUCKET = 'avatars';

export type AvatarCleanupOutcome =
  /** Deletion requested and recorded on the abandoned-uploads ledger; not a confirmed removal. */
  | 'delete_queued'
  /** The deletion could not even be recorded. */
  | 'delete_failed'
  | 'skipped_not_ours'
  | 'skipped_same'
  | 'skipped_reference_changed'
  | 'skipped_still_referenced'
  | 'skipped_reference_unknown';

/** The object path inside the avatars bucket of one of the member's own avatar URLs, or null. */
export function avatarPathFromUrl(avatarUrl: string | null | undefined, userId: string): string | null {
  if (!avatarUrl) return null;
  const path = publicFilePath(avatarUrl, AVATAR_BUCKET);
  // Only an object under the member's own folder, never a path that climbs out of it.
  return path !== null && path.startsWith(`${userId}/`) && !path.includes('..') ? path : null;
}

/** Reads the profile's current `avatar_url` from the server (never from a cache). */
export type ReadCurrentAvatarUrl = () => Promise<string | null>;

async function readSafely(read: ReadCurrentAvatarUrl): Promise<{ ok: true; url: string | null } | { ok: false }> {
  try {
    return { ok: true, url: await read() };
  } catch {
    return { ok: false };
  }
}

async function deleteGeneration(path: string): Promise<AvatarCleanupOutcome> {
  try {
    // Both objects are finished writes: deletable at once, retried by the ledger if this fails.
    await abandonUpload(AVATAR_BUCKET, path, Date.now(), { settled: true });
    await abandonUpload(AVATAR_BUCKET, deriveThumbPath(path), Date.now(), { settled: true });
    return 'delete_queued';
  } catch (err) {
    console.warn('avatar_cleanup:', err instanceof Error ? err.message : err);
    return 'delete_failed';
  }
}

/** After a replacement was committed: deletes the previous generation if nothing references it. */
export async function retirePreviousAvatar(input: {
  userId: string;
  previousUrl: string | null | undefined;
  committedUrl: string;
  readCurrentAvatarUrl: ReadCurrentAvatarUrl;
}): Promise<AvatarCleanupOutcome> {
  const oldPath = avatarPathFromUrl(input.previousUrl, input.userId);
  if (!oldPath) return 'skipped_not_ours';
  if (oldPath === avatarPathFromUrl(input.committedUrl, input.userId)) return 'skipped_same';
  const current = await readSafely(input.readCurrentAvatarUrl);
  if (!current.ok) return 'skipped_reference_unknown';
  if (current.url !== input.committedUrl) return 'skipped_reference_changed';
  return deleteGeneration(oldPath);
}

/** An upload the member never saved (picked again, or left without saving): deletes it if unreferenced. */
export async function discardUnsavedAvatar(input: {
  userId: string;
  uploadedUrl: string | null | undefined;
  readCurrentAvatarUrl: ReadCurrentAvatarUrl;
}): Promise<AvatarCleanupOutcome> {
  const path = avatarPathFromUrl(input.uploadedUrl, input.userId);
  if (!path) return 'skipped_not_ours';
  const current = await readSafely(input.readCurrentAvatarUrl);
  if (!current.ok) return 'skipped_reference_unknown';
  if (avatarPathFromUrl(current.url, input.userId) === path) return 'skipped_still_referenced';
  return deleteGeneration(path);
}
