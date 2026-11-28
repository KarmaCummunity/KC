// A persisted ledger of storage objects the app wrote (or may have written) but will never
// reference: an aborted or lost upload attempt, a chat image whose message failed to send, an
// avatar generation that was replaced or never saved.
//
// Why a ledger and not one delete: aborting a request does not tell us whether the server will
// still commit it. A delete issued right away can run BEFORE that late commit lands, and the late
// object would then survive unnoticed. So each entry keeps a `settleAfter` time; an immediate
// delete is attempted, but the entry is dropped only after a delete issued at or after
// `settleAfter` succeeds. The 15-minute window is a best-effort retry delay, not a measured bound
// on server completion. Sweeps run whenever an upload starts; a write that lands after a final
// sweep can still leave an orphan. This device ledger does not prove deletion quiescence.
//
// Limits (stated, not hidden): the ledger lives on this device. If the app is never opened again,
// or the member signs out for good, entries are not swept from here; `post-images` and `avatars`
// objects are then still removed by the server's orphan reconciliation (unreferenced and older than
// a day), but `chat-media` has no server reconciliation yet (owner: the storage orphan job).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseClient } from '@kc/infrastructure-supabase';

const STORAGE_KEY = 'kc.media.abandonedUploads.v1';
/** Best-effort delay before a retrying delete; not a bound on late server commits. */
export const ABANDON_SETTLE_MS = 15 * 60_000;
/** Bound on the ledger, so a device that can never delete (offline for good) does not grow forever. */
const MAX_ENTRIES = 200;
/** Only existing media buckets, never an arbitrary persisted destination. */
const MEDIA_BUCKETS = new Set(['post-images', 'chat-media', 'avatars']);
const validEntry = (entry: AbandonedUpload): boolean =>
  MEDIA_BUCKETS.has(entry?.bucket) && typeof entry.path === 'string' &&
  MEMBER_PATH.test(entry.path) && !entry.path.split('/').includes('..') && Number.isFinite(entry.settleAfter);
/** A member's object path: `<uuid-like id>/<plain path>`, never climbing out of the folder. */
const MEMBER_PATH = /^[A-Za-z0-9-]{1,64}\/[A-Za-z0-9._/-]{1,400}$/;

export interface AbandonedUpload {
  readonly bucket: string;
  readonly path: string;
  /** Earliest time a successful delete may retire this best-effort retry entry. */
  readonly settleAfter: number;
}

let queue: Promise<unknown> = Promise.resolve();
/** Runs ledger read-modify-write steps one at a time (concurrent records must not be lost). */
function serialized<T>(step: () => Promise<T>): Promise<T> {
  const next = queue.then(step, step);
  queue = next.catch(() => undefined);
  return next;
}

async function readLedger(): Promise<AbandonedUpload[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as AbandonedUpload[]).filter(validEntry) : [];
  } catch {
    return [];
  }
}

async function writeLedger(entries: AbandonedUpload[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // Storage unavailable: the server-side reconciliation is the remaining backstop.
  }
}

/** One delete; true when Storage accepted it (deleting an absent object also succeeds). */
async function tryRemove(entry: AbandonedUpload): Promise<boolean> {
  try {
    const { error } = await getSupabaseClient().storage.from(entry.bucket).remove([entry.path]);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Records an object the app will never reference and tries to delete it now. `settled: true`
 * means the write is known to be finished (it succeeded, or the server answered an error), so a
 * successful delete is final at once.
 */
export function abandonUpload(bucket: string, path: string, now = Date.now(), opts: { settled?: boolean } = {}): Promise<void> {
  if (!MEDIA_BUCKETS.has(bucket) || !MEMBER_PATH.test(path) || path.split('/').includes('..')) return Promise.resolve();
  const entry: AbandonedUpload = { bucket, path, settleAfter: opts.settled ? now : now + ABANDON_SETTLE_MS };
  return serialized(async () => {
    const ledger = await readLedger();
    if (!ledger.some((e) => e.bucket === bucket && e.path === path)) ledger.push(entry);
    await writeLedger(ledger);
  }).then(() => sweepEntry(entry, now));
}

/** Deletes one entry, retiring its retry record after the best-effort delay and a successful delete. */
async function sweepEntry(entry: AbandonedUpload, now: number): Promise<void> {
  const removed = await tryRemove(entry);
  if (!removed || now < entry.settleAfter) return;
  await serialized(async () => {
    const ledger = await readLedger();
    await writeLedger(ledger.filter((e) => !(e.bucket === entry.bucket && e.path === entry.path)));
  });
}

/** Deletes every settled entry of the signed-in member; keeps the rest for a later sweep. */
export async function sweepAbandonedUploads(now = Date.now()): Promise<void> {
  const { data } = await getSupabaseClient().auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return;
  const due = (await readLedger()).filter((e) => e.settleAfter <= now && e.path.startsWith(`${userId}/`));
  for (const entry of due) await sweepEntry(entry, now);
}

/** The entries still waiting for a final delete (diagnostics and tests). */
export function pendingAbandoned(): Promise<AbandonedUpload[]> {
  return serialized(readLedger);
}
