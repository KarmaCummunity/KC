// Public image URLs and, where the file host offers them, transform URLs (#897).
//
// Default path (PERF-4): the sibling `-thumb` object written at upload time for small surfaces,
// the original for the detail hero. Both are plain public objects: no per-image cost.
// CDN transforms are a paid add-on of Supabase Storage ("enabled for Pro Plan and above";
// $5 per 1,000 origin images beyond the plan quota of 100: supabase.com/docs/guides/storage/serving/
// image-transformations and .../platform/manage-your-usage/storage-image-transformations), so they
// are OPT-IN: only a build with `EXPO_PUBLIC_USE_STORAGE_TRANSFORM=1` asks for them, and only
// where the file host makes them. Every address comes from the storage door.

import { isPublicFileUrl, publicFileUrl, resizedImageUrl, resizesImagesOnRequest } from '../services/backend/storageBackend';

export type ImageTransformFormat = 'origin' | 'webp' | 'avif';

type Args = {
  bucket: string;
  path: string;
  width?: number;
  quality?: number;
  format?: ImageTransformFormat;
};

type ThumbArgs = { bucket: string; path: string; width?: number; format?: ImageTransformFormat };

/** Transforms are billed per origin image, so a build must opt in explicitly, and the file host must make them. */
function transformsEnabled(): boolean {
  return process.env.EXPO_PUBLIC_USE_STORAGE_TRANSFORM === '1' && resizesImagesOnRequest();
}

function wantsTransform(args: Pick<Args, 'width' | 'quality' | 'format'>): boolean {
  if (!transformsEnabled()) return false;
  return (
    typeof args.width === 'number' ||
    typeof args.quality === 'number' ||
    (args.format !== undefined && args.format !== 'origin')
  );
}

/**
 * Builds a transform URL (CDN resize + modern format). Where the file host makes no
 * transforms the plain public URL is the answer: the image still shows, at its stored size.
 */
export function buildSupabaseImageTransformUrl({
  bucket,
  path,
  width,
  quality = 80,
  format = 'webp',
}: Args): string {
  if (!path) return '';
  const params = new URLSearchParams();
  if (typeof width === 'number') params.set('width', String(Math.round(width)));
  params.set('quality', String(quality));
  if (format && format !== 'origin') params.set('format', format);
  return resizedImageUrl(bucket, path, params.toString()) ?? publicFileUrl(bucket, path);
}

export function getSupabasePublicImageUrl({ bucket, path, width, quality, format }: Args): string {
  if (!path) return '';
  if (wantsTransform({ width, quality, format })) {
    return buildSupabaseImageTransformUrl({ bucket, path, width, quality, format });
  }
  return publicFileUrl(bucket, path);
}

/** `a/b/c.jpg` → `a/b/c-thumb.jpg`. */
export function deriveThumbPath(path: string): string {
  if (!path) return path;
  const dotIdx = path.lastIndexOf('.');
  const slashIdx = path.lastIndexOf('/');
  if (dotIdx === -1 || dotIdx < slashIdx) return `${path}-thumb`;
  return `${path.slice(0, dotIdx)}-thumb${path.slice(dotIdx)}`;
}

/** Thumb object URL, optionally via transform when width/format provided. */
export function getSupabaseImageThumbUrl({ bucket, path, width, format }: ThumbArgs): string {
  if (!path) return '';
  if (wantsTransform({ width, format })) {
    return buildSupabaseImageTransformUrl({
      bucket,
      path: deriveThumbPath(path),
      width,
      quality: 75,
      format: format ?? 'webp',
    });
  }
  return getSupabasePublicImageUrl({ bucket, path: deriveThumbPath(path) });
}

/** Feed/grid surface: the 400 px `-thumb` sibling (or, when opted in, a transform at display width). */
export function getSupabaseFeedImageUrl(
  bucket: string,
  path: string,
  displayWidthPx: number,
): string {
  if (!path) return '';
  const scaled = Math.min(1200, Math.max(64, Math.ceil(displayWidthPx * 2)));
  if (wantsTransform({ width: scaled, format: 'webp' })) {
    return buildSupabaseImageTransformUrl({
      bucket,
      path,
      width: scaled,
      quality: 78,
      format: 'webp',
    });
  }
  return getSupabaseImageThumbUrl({ bucket, path });
}

/**
 * Detail-page hero photo: a transform sized to the screen (2x for density, capped) instead of the
 * 2048 px upload (~300-500 KB each). When transforms are off there is no smaller sibling that is
 * sharp at this size (the `-thumb` is 400 px), so the original is the answer.
 */
export function getSupabaseHeroImageUrl(
  bucket: string,
  path: string,
  displayWidthPx: number,
): string {
  if (!path) return '';
  const scaled = Math.min(1600, Math.max(320, Math.ceil(displayWidthPx * 2)));
  if (wantsTransform({ width: scaled, format: 'webp' })) {
    return buildSupabaseImageTransformUrl({ bucket, path, width: scaled, quality: 80, format: 'webp' });
  }
  return getSupabasePublicImageUrl({ bucket, path });
}

export function deriveThumbUrl(fullUrl: string): string {
  if (!fullUrl) return fullUrl;
  if (!isPublicFileUrl(fullUrl)) return fullUrl;
  try {
    const url = new URL(fullUrl);
    url.pathname = deriveThumbPath(url.pathname);
    return url.toString();
  } catch {
    return fullUrl;
  }
}
