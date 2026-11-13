// Supabase Storage public + transform URLs (#897).
//
// Default path (PERF-4): sibling `-thumb` objects at upload time.
// When `width` / `quality` / `format` are passed, uses `/render/image/` CDN transforms
// unless `EXPO_PUBLIC_USE_STORAGE_TRANSFORM=0`.

import { getSupabasePublicEnv } from './supabasePublicConfig';

export type ImageTransformFormat = 'origin' | 'webp' | 'avif';

type Args = {
  bucket: string;
  path: string;
  width?: number;
  quality?: number;
  format?: ImageTransformFormat;
};

type ThumbArgs = { bucket: string; path: string; width?: number; format?: ImageTransformFormat };

function getSupabaseBaseUrl(): string | null {
  const env = getSupabasePublicEnv();
  if (!env) return null;
  return env.url.replace(/\/$/, '');
}

function transformsDisabled(): boolean {
  return process.env.EXPO_PUBLIC_USE_STORAGE_TRANSFORM === '0';
}

function wantsTransform(args: Pick<Args, 'width' | 'quality' | 'format'>): boolean {
  if (transformsDisabled()) return false;
  if (process.env.EXPO_PUBLIC_USE_STORAGE_TRANSFORM === '1') return true;
  return (
    typeof args.width === 'number' ||
    typeof args.quality === 'number' ||
    (args.format !== undefined && args.format !== 'origin')
  );
}

/** Builds a Supabase Storage transform URL (CDN resize + modern format). */
export function buildSupabaseImageTransformUrl({
  bucket,
  path,
  width,
  quality = 80,
  format = 'webp',
}: Args): string {
  if (!path) return '';
  const base = getSupabaseBaseUrl();
  if (!base) return '';
  const params = new URLSearchParams();
  if (typeof width === 'number') params.set('width', String(Math.round(width)));
  params.set('quality', String(quality));
  if (format && format !== 'origin') params.set('format', format);
  return `${base}/storage/v1/render/image/public/${bucket}/${path}?${params.toString()}`;
}

export function getSupabasePublicImageUrl({ bucket, path, width, quality, format }: Args): string {
  if (!path) return '';
  if (wantsTransform({ width, quality, format })) {
    return buildSupabaseImageTransformUrl({ bucket, path, width, quality, format });
  }
  const base = getSupabaseBaseUrl();
  if (!base) return '';
  return `${base}/storage/v1/object/public/${bucket}/${path}`;
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

/** Feed/grid surface: prefer transform at display width, else `-thumb` sibling. */
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
  if (!fullUrl.includes('/storage/v1/object/public/')) return fullUrl;
  try {
    const url = new URL(fullUrl);
    url.pathname = deriveThumbPath(url.pathname);
    return url.toString();
  } catch {
    return fullUrl;
  }
}
