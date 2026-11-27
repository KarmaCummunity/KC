// Pick + upload of post photos, shared by the create and edit screens (FR-POST-005, FR-POST-008).
//
// Each pick uploads under its own batch folder with bounded parallelism; photos join the gallery
// one by one, in the order they were picked, as soon as they are stored, and the pending tiles
// shrink with them. Every upload has a time budget and retries (storageObjectUpload.ts), so the
// "uploading" state always ends. Leaving the screen, or `cancelUploads`, aborts the work left.

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { pickPostImages, uploadPostImageBatch, type UploadedAsset } from '../services/imageUpload';
import { isBlockedMediaPick, type MediaPermissionKind } from '../lib/mediaPermissionTypes';
import { createOrderedCommitter, isUploadCancelled } from '../services/uploadControl';

export interface PostImageUploadSummary {
  /** Photos stored and added to the gallery. */
  readonly ok: number;
  /** Photos the pick tried, cancelled ones excluded. */
  readonly total: number;
  /** First failure reason, for the notice. */
  readonly firstError: unknown;
}

interface Args {
  readonly ownerId: string | null | undefined;
  /** Photos already in the gallery (they count against the per-post limit). */
  readonly galleryCount: number;
  readonly setUploads: Dispatch<SetStateAction<UploadedAsset[]>>;
  /** No signed-in owner: the screen asks to sign in again. */
  readonly onMissingOwner: () => void;
  /** Some photos of a pick failed (not counting cancellations). */
  readonly onFailures: (summary: PostImageUploadSummary) => void;
}

export function usePostImageUploads({ ownerId, galleryCount, setUploads, onMissingOwner, onFailures }: Args) {
  const [uploadingCount, setUploadingCount] = useState(0);
  const [permissionBlocked, setPermissionBlocked] = useState<MediaPermissionKind | null>(null);
  const controllers = useRef(new Set<AbortController>());
  const mounted = useRef(true);

  // Abort every in-flight pick when the screen goes away, and stop touching its state.
  useEffect(() => {
    mounted.current = true;
    const active = controllers.current;
    return () => {
      mounted.current = false;
      active.forEach((c) => c.abort());
      active.clear();
    };
  }, []);

  const cancelUploads = useCallback(() => {
    controllers.current.forEach((c) => c.abort());
  }, []);

  const pickAndUpload = useCallback(async () => {
    if (!ownerId) {
      onMissingOwner();
      return;
    }
    const picked = await pickPostImages(galleryCount + uploadingCount);
    if (!mounted.current) return;
    if (isBlockedMediaPick(picked)) {
      setPermissionBlocked(picked.kind);
      return;
    }
    setPermissionBlocked(null);
    if (picked.status !== 'ok' || picked.value.length === 0) return;
    const images = picked.value;

    const controller = new AbortController();
    controllers.current.add(controller);
    setUploadingCount((n) => n + images.length);
    const commit = createOrderedCommitter<UploadedAsset>(images.length, (values, released) => {
      if (!mounted.current) return;
      if (values.length > 0) setUploads((prev) => [...prev, ...values]);
      setUploadingCount((n) => Math.max(0, n - released));
    });
    try {
      const results = await uploadPostImageBatch(images, ownerId, { signal: controller.signal, onSettled: commit });
      const failures = results.flatMap((r) => (r.status === 'rejected' && !isUploadCancelled(r.reason) ? [r.reason] : []));
      const cancelled = results.filter((r) => r.status === 'rejected' && isUploadCancelled(r.reason)).length;
      if (failures.length > 0 && mounted.current) {
        const total = results.length - cancelled;
        onFailures({ ok: total - failures.length, total, firstError: failures[0] });
      }
    } finally {
      controllers.current.delete(controller);
    }
  }, [ownerId, galleryCount, uploadingCount, setUploads, onMissingOwner, onFailures]);

  return { uploadingCount, permissionBlocked, pickAndUpload, cancelUploads };
}
