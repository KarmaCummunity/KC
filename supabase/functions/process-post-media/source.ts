// process-post-media · what the claim says about a job's original, checked before anything is downloaded.
//
// The original is a member's upload: in the private `post-uploads` bucket (current app versions) or
// the public `post-images` bucket (older app versions, the WhatsApp bot). The claim names the bucket;
// a claim without it is from before the database knew buckets, when every original was in
// `post-images`. Copies are always written to `post-images/derived/` (index.ts), whatever the source.
import { MAX_SOURCE_BYTES } from './imageCheck.ts';

/** Buckets an original may be read from (mirrors kc_private.post_media_processing.source_bucket). */
export const SOURCE_BUCKETS = ['post-images', 'post-uploads'] as const;
export type SourceBucket = typeof SOURCE_BUCKETS[number];

/** The bucket a claim row is read from when it names none (claims made before buckets existed). */
export const LEGACY_SOURCE_BUCKET: SourceBucket = 'post-images';

const SOURCE_TYPES = new Set(['image/jpeg', 'image/png']);
/** `<owner uuid>/<path>` with plain path characters and no `..` segment. */
const OWNED_KEY = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[A-Za-z0-9._\/-]{1,400}$/;

/** What preflight reads from a claimed job. */
export interface SourceFacts {
  readonly owner_id: string;
  /** Absent on a claim made before the database recorded the original's bucket. */
  readonly storage_bucket?: string | null;
  readonly storage_key: string;
  readonly object_size: number | null;
  readonly object_mimetype: string | null;
}

/** A refusal that no retry can change; its message is the code recorded on the job. */
export class FinalRefusal extends Error {}

/** The bucket the original is read from; refuses one the worker never reads. */
export function sourceBucket(job: SourceFacts): SourceBucket {
  const bucket = job.storage_bucket ?? LEGACY_SOURCE_BUCKET;
  if (!(SOURCE_BUCKETS as readonly string[]).includes(bucket)) throw new FinalRefusal('foreign_bucket');
  return bucket as SourceBucket;
}

/**
 * Pre-download refusals, from what the claim says about the row and the stored object: a bucket the
 * worker never reads, a key outside the owner's folder, and an object Storage recorded as missing,
 * over 8 MiB or not JPEG/PNG. Returns the bucket to read from.
 */
export function preflight(job: SourceFacts): SourceBucket {
  const bucket = sourceBucket(job);
  const owned = OWNED_KEY.exec(job.storage_key);
  if (!owned || owned[1] !== job.owner_id || job.storage_key.split('/').includes('..')) {
    throw new FinalRefusal('foreign_or_invalid_path');
  }
  if (job.object_size === null) throw new FinalRefusal('object_missing');
  if (job.object_size > MAX_SOURCE_BYTES) throw new FinalRefusal('too_large');
  if (!job.object_mimetype || !SOURCE_TYPES.has(job.object_mimetype)) throw new FinalRefusal('unsupported_type');
  return bucket;
}
