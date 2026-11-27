// FR-POST-007 AC3 — probe each draft image against Supabase Storage so that
// assets the user uploaded for a draft but whose backing file is no longer
// reachable (revoked, expired, manually deleted) can be rendered as a
// placeholder with a re-add prompt.
//
// The default adapter calls Supabase Storage; tests inject a fake.
import { signFileUrl } from '../services/backend/storageBackend';
import type { UploadedAsset } from '../services/imageUpload';

export interface DraftImage extends UploadedAsset {
  /** True when the underlying storage object is unreachable. */
  readonly missing?: boolean;
}

export interface DraftImageProbeResult {
  readonly assets: readonly DraftImage[];
  readonly missingCount: number;
}

/** Lower-level adapter. Returns true when the path is reachable. */
export type StorageProbe = (path: string) => Promise<boolean>;

const POST_BUCKET = 'post-images';

/** Default probe: short-lived signed URL request. Any error → missing. */
export const defaultStorageProbe: StorageProbe = async (path) => {
  try {
    return Boolean(await signFileUrl(POST_BUCKET, path, 60));
  } catch {
    return false;
  }
};

/**
 * Returns the asset list with `missing: true` set on any asset the probe says
 * is unreachable. Preserves input order so the photo grid render stays stable.
 */
export async function probeDraftImageAvailability(
  uploads: readonly UploadedAsset[],
  probe: StorageProbe = defaultStorageProbe,
): Promise<DraftImageProbeResult> {
  if (uploads.length === 0) return { assets: [], missingCount: 0 };
  const results: DraftImage[] = await Promise.all(
    uploads.map(async (u): Promise<DraftImage> => {
      const ok = await probe(u.path);
      return ok ? { ...u } : { ...u, missing: true };
    }),
  );
  const missingCount = results.reduce((n, a) => n + (a.missing ? 1 : 0), 0);
  return { assets: results, missingCount };
}
